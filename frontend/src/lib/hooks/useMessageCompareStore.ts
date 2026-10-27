import { create } from 'zustand';
import { TopicMessage } from 'generated-sources';

export const MAX_COMPARED_MESSAGES = 2;

export const messageCompareId = ({
  partition,
  offset,
}: Pick<TopicMessage, 'partition' | 'offset'>) => `${partition}:${offset}`;

export const messageCompareScope = (clusterName: string, topicName: string) =>
  JSON.stringify([clusterName, topicName]);

interface MessageCompareState {
  // Selections belong to one cluster/topic; picking a message elsewhere starts over.
  scope?: string;
  selected: TopicMessage[];
  toggle: (scope: string, message: TopicMessage) => void;
  clear: () => void;
}

export const useMessageCompareStore = create<MessageCompareState>((set) => ({
  scope: undefined,
  selected: [],
  toggle: (scope, message) =>
    set((state) => {
      const current = state.scope === scope ? state.selected : [];
      const id = messageCompareId(message);
      if (current.some((selected) => messageCompareId(selected) === id)) {
        return {
          scope,
          selected: current.filter(
            (selected) => messageCompareId(selected) !== id
          ),
        };
      }
      // Keep the most recent picks so a third selection replaces the oldest.
      return {
        scope,
        selected: [...current, message].slice(-MAX_COMPARED_MESSAGES),
      };
    }),
  clear: () => set({ scope: undefined, selected: [] }),
}));

const EMPTY_SELECTION: TopicMessage[] = [];

export const useComparedMessages = (scope: string) =>
  useMessageCompareStore((state) =>
    state.scope === scope ? state.selected : EMPTY_SELECTION
  );

export const useIsSelectedForCompare = (
  scope: string | undefined,
  message: Pick<TopicMessage, 'partition' | 'offset'>
) =>
  useMessageCompareStore(
    (state) =>
      scope !== undefined &&
      state.scope === scope &&
      state.selected.some(
        (selected) => messageCompareId(selected) === messageCompareId(message)
      )
  );

import React, { useCallback, useContext, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import useAppParams from 'lib/hooks/useAppParams';
import { ClusterNameRoute } from 'lib/paths';
import ClusterContext from 'components/contexts/ClusterContext';

import * as S from './CommandPalette.styled';
import CommandPaletteResults from './CommandPaletteResults';
import CommandPaletteQuickAccess from './CommandPaletteQuickAccess';
import { PaletteItem } from './CommandPaletteList';

function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(id);
  }, [value, delayMs]);
  return debounced;
}

const CommandPalette: React.FC = () => {
  const { clusterName } = useAppParams<ClusterNameRoute>();
  const { hasSchemaRegistryConfigured, hasKafkaConnectConfigured } =
    useContext(ClusterContext);
  const navigate = useNavigate();

  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState('');
  const debouncedQuery = useDebouncedValue(query, 200);
  const [items, setItems] = useState<PaletteItem[]>([]);
  const [highlight, setHighlight] = useState(0);

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (
        !(event.metaKey || event.ctrlKey) ||
        event.key?.toLowerCase() !== 'k'
      ) {
        return;
      }
      // Leave the shortcut to editors (e.g. Ace find-next) that handle it.
      const { target } = event;
      if (
        event.defaultPrevented ||
        (target instanceof Element && target.closest('.ace_editor'))
      ) {
        return;
      }
      event.preventDefault();
      setIsOpen((open) => !open);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  const close = useCallback(() => {
    setIsOpen(false);
    setQuery('');
    setItems([]);
    setHighlight(0);
  }, []);

  const select = useCallback(
    (to: string) => {
      navigate(to);
      close();
    },
    [navigate, close]
  );

  useEffect(() => {
    setHighlight(0);
  }, [debouncedQuery]);

  if (!isOpen) {
    return null;
  }

  const trimmedQuery = debouncedQuery.trim();

  const handleKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'Escape') {
      close();
    } else if (event.key === 'ArrowDown') {
      event.preventDefault();
      setHighlight((current) =>
        Math.min(current + 1, Math.max(items.length - 1, 0))
      );
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setHighlight((current) => Math.max(current - 1, 0));
    } else if (event.key === 'Enter') {
      const item = items[highlight];
      if (item) {
        select(item.to);
      }
    }
  };

  return (
    <S.Overlay onClick={close} data-testid="command-palette">
      {/* eslint-disable-next-line jsx-a11y/no-static-element-interactions */}
      <S.Panel
        onClick={(event) => event.stopPropagation()}
        onKeyDown={handleKeyDown}
      >
        <S.SearchInput
          // eslint-disable-next-line jsx-a11y/no-autofocus
          autoFocus
          type="text"
          placeholder="Search topics, consumer groups, schemas, connectors…"
          aria-label="Command palette search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        {trimmedQuery.length > 0 ? (
          <CommandPaletteResults
            clusterName={clusterName}
            query={trimmedQuery}
            hasSchemaRegistry={hasSchemaRegistryConfigured}
            hasKafkaConnect={hasKafkaConnectConfigured}
            highlightIndex={highlight}
            onItems={setItems}
            onSelect={select}
          />
        ) : (
          <CommandPaletteQuickAccess
            clusterName={clusterName}
            highlightIndex={highlight}
            onItems={setItems}
            onSelect={select}
          />
        )}
      </S.Panel>
    </S.Overlay>
  );
};

export default CommandPalette;

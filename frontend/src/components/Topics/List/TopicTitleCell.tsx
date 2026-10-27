import React from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { CellContext } from '@tanstack/react-table';
import { Tag } from 'components/common/Tag/Tag.styled';
import { Topic } from 'generated-sources';
import { showServerError } from 'lib/errorHandling';
import { topicDetailsQueryOptions } from 'lib/hooks/api/topics';
import useAppParams from 'lib/hooks/useAppParams';
import { ClusterNameRoute } from 'lib/paths';
import { NavLink } from 'react-router-dom';
import FavoriteToggle from 'components/common/FavoriteToggle/FavoriteToggle';
import { WithFavoriteToggle } from 'components/common/FavoriteToggle/FavoriteToggle.styled';

export const TopicTitleCell: React.FC<CellContext<Topic, unknown>> = ({
  row: { original },
}) => {
  const { internal, name } = original;
  const { clusterName } = useAppParams<ClusterNameRoute>();
  const queryClient = useQueryClient();
  const prefetchTimer = React.useRef<number | undefined>(undefined);

  const prefetchTopic = () => {
    import('components/Topics/Topic/Topic').catch(showServerError);
    if (prefetchTimer.current !== undefined) {
      window.clearTimeout(prefetchTimer.current);
    }
    prefetchTimer.current = window.setTimeout(() => {
      prefetchTimer.current = undefined;
      queryClient
        .prefetchQuery(
          topicDetailsQueryOptions({ clusterName, topicName: name })
        )
        .catch(showServerError);
    }, 150);
  };

  const cancelTopicPrefetch = () => {
    if (prefetchTimer.current !== undefined) {
      window.clearTimeout(prefetchTimer.current);
      prefetchTimer.current = undefined;
    }
  };

  return (
    <WithFavoriteToggle>
      <FavoriteToggle
        clusterName={clusterName}
        type="topic"
        name={name}
        size="S"
      />
      <NavLink
        to={name}
        title={name}
        onMouseEnter={prefetchTopic}
        onMouseLeave={cancelTopicPrefetch}
        onFocus={prefetchTopic}
        onBlur={cancelTopicPrefetch}
        style={{ wordBreak: 'break-word', whiteSpace: 'pre-wrap' }}
      >
        {internal && (
          <Tag color="gray" style={{ marginRight: '0.75em' }}>
            IN
          </Tag>
        )}
        {name}
      </NavLink>
    </WithFavoriteToggle>
  );
};

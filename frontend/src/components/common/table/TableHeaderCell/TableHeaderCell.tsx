import React, { PropsWithChildren } from 'react';
import { SortOrder } from 'generated-sources';
import * as S from 'components/common/table/TableHeaderCell/TableHeaderCell.styled';

export interface TableHeaderCellProps {
  title?: string;
  previewText?: string;
  onPreview?: () => void;
  orderBy?: string | null;
  sortOrder?: SortOrder;
  orderValue?: string;
  handleOrderBy?: (orderBy: string | null) => void;
  onResizeStart?: (event: React.PointerEvent<HTMLButtonElement>) => void;
  onResizeBy?: (delta: number) => void;
  onResizeReset?: () => void;
}

const TableHeaderCell: React.FC<PropsWithChildren<TableHeaderCellProps>> = (
  props
) => {
  const {
    title,
    previewText,
    onPreview,
    orderBy,
    sortOrder,
    orderValue,
    handleOrderBy,
    onResizeStart,
    onResizeBy,
    onResizeReset,
    ...restProps
  } = props;

  const isOrdered = !!orderValue && orderValue === orderBy;
  const isOrderable = !!(orderValue && handleOrderBy);

  const handleOnClick = () => {
    return orderValue && handleOrderBy && handleOrderBy(orderValue);
  };
  const handleOnKeyDown = (event: React.KeyboardEvent) => {
    if (event.code === 'Space' || event.key === 'Enter') {
      event.preventDefault();
      handleOnClick();
    }
  };
  const handleResizeKeyDown = (
    event: React.KeyboardEvent<HTMLButtonElement>
  ) => {
    if (event.key === 'Home') {
      event.preventDefault();
      event.stopPropagation();
      onResizeReset?.();
      return;
    }

    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;

    event.preventDefault();
    event.stopPropagation();
    const step = event.shiftKey ? 40 : 16;
    onResizeBy?.(event.key === 'ArrowLeft' ? -step : step);
  };
  const handleResizePointerDown = (
    event: React.PointerEvent<HTMLButtonElement>
  ) => {
    event.stopPropagation();
    onResizeStart?.(event);
  };
  const orderableProps = isOrderable && {
    isOrderable,
    sortOrder,
    onClick: handleOnClick,
    onKeyDown: handleOnKeyDown,
    role: 'button',
    tabIndex: 0,
  };
  const orderedDirection =
    sortOrder === SortOrder.ASC ? 'ascending' : 'descending';
  return (
    <S.TableHeaderCell
      {...restProps}
      aria-sort={isOrdered ? orderedDirection : undefined}
    >
      <S.Title isOrdered={isOrdered} {...orderableProps}>
        {title}
      </S.Title>

      {previewText && (
        <S.Preview
          onClick={onPreview}
          onKeyDown={onPreview}
          role="button"
          tabIndex={0}
        >
          {previewText}
        </S.Preview>
      )}
      {onResizeStart && (
        <S.ColumnResizer
          aria-label={`Resize ${title || 'column'} column`}
          type="button"
          onClick={(event) => event.stopPropagation()}
          onDoubleClick={(event) => {
            event.stopPropagation();
            onResizeReset?.();
          }}
          onKeyDown={handleResizeKeyDown}
          onPointerDown={handleResizePointerDown}
        />
      )}
    </S.TableHeaderCell>
  );
};

export default TableHeaderCell;

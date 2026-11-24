import { ControlledMenuProps } from '@szhsin/react-menu';
import React, { cloneElement, PropsWithChildren, useRef } from 'react';
import VerticalElipsisIcon from 'components/common/Icons/VerticalElipsisIcon';
import useBoolean from 'lib/hooks/useBoolean';

import * as S from './Dropdown.styled';

type DropdownTriggerProps = {
  'aria-label'?: string;
  disabled?: boolean;
  onClick?: React.MouseEventHandler<HTMLElement>;
};

interface DropdownProps extends PropsWithChildren<
  Omit<
    Partial<ControlledMenuProps>,
    'anchorRef' | 'menuButton' | 'onClose' | 'state'
  >
> {
  label?: React.ReactNode;
  disabled?: boolean;
  openBtnEl?: React.ReactElement<DropdownTriggerProps>;
  onClose?: () => void;
}

const Dropdown: React.FC<DropdownProps> = ({
  label,
  disabled,
  children,
  openBtnEl,
  onClose,
  ...props
}) => {
  const ref = useRef<HTMLElement | null>(null);
  const { value: isOpen, setFalse, setTrue } = useBoolean(false);

  const handleClick: React.MouseEventHandler<HTMLElement> = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setTrue();
  };

  return (
    <S.Wrapper>
      {openBtnEl ? (
        <span
          ref={(element) => {
            ref.current = element;
          }}
          style={{ display: 'inline-block' }}
        >
          {cloneElement(openBtnEl, {
            onClick: handleClick,
            disabled,
            'aria-label': props['aria-label'] || 'Dropdown Toggle',
          })}
        </span>
      ) : (
        <S.DropdownButton
          onClick={handleClick}
          ref={(element) => {
            ref.current = element;
          }}
          aria-label={props['aria-label'] || 'Dropdown Toggle'}
          disabled={disabled}
        >
          {label || (
            <S.SmallButton>
              <VerticalElipsisIcon />
            </S.SmallButton>
          )}
        </S.DropdownButton>
      )}

      <S.Dropdown
        anchorRef={ref as React.RefObject<Element>}
        state={isOpen ? 'open' : 'closed'}
        onMouseLeave={setFalse}
        onClose={() => {
          setFalse();
          onClose?.();
        }}
        align={props.align || 'end'}
        direction={props.direction || 'bottom'}
        viewScroll="auto"
      >
        {children}
      </S.Dropdown>
    </S.Wrapper>
  );
};

export default Dropdown;

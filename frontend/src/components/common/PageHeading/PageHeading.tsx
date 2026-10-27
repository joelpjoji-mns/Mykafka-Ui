import React, { PropsWithChildren, ReactNode } from 'react';
import Heading from 'components/common/heading/Heading.styled';
import { buildPageTitle } from 'lib/pageTitles';

import * as S from './PageHeading.styled';

interface PageHeadingProps {
  text: string;
  backTo?: string;
  backText?: string;
  title?: string;
  documentTitle?: string;
  headingAddon?: ReactNode;
}

const PageHeading: React.FC<PropsWithChildren<PageHeadingProps>> = ({
  text,
  backTo,
  backText,
  children,
  title,
  documentTitle,
  headingAddon,
}) => {
  const isBackButtonVisible = backTo && backText;
  React.useEffect(() => {
    document.title = documentTitle || buildPageTitle(text, title);
  }, [documentTitle, text, title]);

  return (
    <S.Wrapper>
      {title ? <S.Title>{title}</S.Title> : null}
      <S.Content>
        <S.Breadcrumbs>
          {isBackButtonVisible && (
            <S.BackLink to={backTo}>{backText}</S.BackLink>
          )}
          {headingAddon ? (
            <S.HeadingGroup>
              <Heading>{text}</Heading>
              {headingAddon}
            </S.HeadingGroup>
          ) : (
            <Heading>{text}</Heading>
          )}
        </S.Breadcrumbs>
        <div>{children}</div>
      </S.Content>
    </S.Wrapper>
  );
};

export default PageHeading;

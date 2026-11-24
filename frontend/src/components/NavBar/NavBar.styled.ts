import styled, { css } from 'styled-components';
import { Link } from 'react-router-dom';
import GitHubIcon from 'components/common/Icons/GitHubIcon';

export const Navbar = styled.nav(
  ({ theme }) => css`
    display: flex;
    align-items: center;
    justify-content: space-between;
    border-bottom: 1px solid ${theme.effects.navigationBorder};
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    z-index: 30;
    background-color: ${theme.effects.navigationSurface};
    backdrop-filter: ${theme.effects.navigationBackdropFilter};
    -webkit-backdrop-filter: ${theme.effects.navigationBackdropFilter};
    box-shadow: ${theme.effects.navigationShadow};
    min-height: 3.25rem;

    @media screen and (max-width: ${theme.breakpoints.S}px) {
      justify-content: flex-start;
    }

    @media (prefers-reduced-transparency: reduce), (prefers-contrast: more) {
      background-color: ${theme.effects.reducedTransparencyNavigationSurface};
      backdrop-filter: none;
      -webkit-backdrop-filter: none;
    }

    @supports not (
      (backdrop-filter: blur(1px)) or (-webkit-backdrop-filter: blur(1px))
    ) {
      background-color: ${theme.effects.reducedTransparencyNavigationSurface};
      backdrop-filter: none;
      -webkit-backdrop-filter: none;
    }
  `
);

export const NavbarBrand = styled.div`
  display: flex;
  justify-content: flex-end;
  align-items: center !important;
  flex-shrink: 0;
  min-height: 3.25rem;
  padding-left: 8px;
`;

export const BrandName = styled.span`
  .compact {
    display: none;
  }

  @media screen and (max-width: ${({ theme }) => theme.breakpoints.S}px) {
    .full {
      display: none;
    }

    .compact {
      display: inline;
    }
  }
`;

export const SocialLink = styled.a(
  ({ theme }) => css`
    display: block;
    margin-top: 5px;
    cursor: pointer;
    fill: ${theme.layout.socialLink};

    &:hover {
      ${GitHubIcon} {
        fill: ${theme.icons.github.hover};
      }
    }

    &:active {
      ${GitHubIcon} {
        fill: ${theme.icons.github.active};
      }
    }
  `
);

export const NavbarSocial = styled.div`
  display: flex;
  align-items: center;
  gap: 10px;
  margin: 5px 10px 5px;

  @media screen and (max-width: ${({ theme }) => theme.breakpoints.S}px) {
    gap: 6px;
    margin: 5px 8px 5px 0;
  }
`;

export const TimezoneItem = styled.div`
  @media screen and (max-width: ${({ theme }) => theme.breakpoints.S}px) {
    display: none;
  }
`;

export const ThemeOption = styled.span`
  display: inline-flex;
  align-items: center;
  gap: 8px;
`;

export const ThemeSwatch = styled.span<{
  $primary: string;
  $secondary?: string;
}>`
  width: 14px;
  height: 14px;
  flex: 0 0 14px;
  border: 1px solid ${({ theme }) => theme.select.borderColor.normal};
  border-radius: 50%;
  background: ${({ $primary, $secondary }) =>
    $secondary
      ? `linear-gradient(135deg, ${$primary} 0 50%, ${$secondary} 50% 100%)`
      : $primary};
`;

export const NavbarItem = styled.div`
  display: flex;
  position: relative;
  flex-grow: 0;
  flex-shrink: 0;
  align-items: center;
  line-height: 1.5;
  padding: 0.5rem 0.75rem;

  @media screen and (max-width: ${({ theme }) => theme.breakpoints.S}px) {
    display: none;
  }
`;

export const Hyperlink = styled(Link)(
  ({ theme }) => css`
    position: relative;

    display: flex;
    flex-grow: 0;
    flex-shrink: 0;
    align-items: center;
    gap: 8px;

    margin: 0;
    padding: 0.5rem 0.6rem;

    font-family: Inter, sans-serif;
    font-style: normal;
    font-weight: bold;
    font-size: 22px;
    line-height: 16px;
    color: ${theme.default.color.normal};

    &:hover {
      color: ${theme.default.color.normal};
    }

    text-decoration: none;
    word-break: break-word;
    cursor: pointer;

    @media screen and (max-width: ${theme.breakpoints.S}px) {
      gap: 6px;
      padding: 0.5rem 0.4rem;
      font-size: 18px;
    }
  `
);

import { describe, expect, test } from 'bun:test';
import { screen } from '@testing-library/react';
import ViewOwnerAvatar from '../../../components/shared/ViewOwnerAvatar';
import { installI18nMock } from '../../helpers/i18n';
import { render } from '../../helpers/render';

installI18nMock();

describe('<ViewOwnerAvatar />', () => {
  test('renders first+last initials for a multi-word owner name', () => {
    render(<ViewOwnerAvatar ownerName="Top Manager" />);
    expect(screen.getByText('TM')).toBeInTheDocument();
  });

  test('renders the first two letters for a single-word owner name', () => {
    render(<ViewOwnerAvatar ownerName="Madonna" />);
    expect(screen.getByText('MA')).toBeInTheDocument();
  });

  test('falls back to "?" when the owner name is blank', () => {
    render(<ViewOwnerAvatar ownerName="   " />);
    expect(screen.getByText('?')).toBeInTheDocument();
  });

  test('exposes a "shared by" accessible label carrying the owner name', () => {
    // The i18n mock is an identity translator, so the label is the raw key — the
    // owner is interpolated into the real string at runtime.
    render(<ViewOwnerAvatar ownerName="Top Manager" />);
    expect(screen.getByLabelText('views.sharedBy')).toBeInTheDocument();
  });
});

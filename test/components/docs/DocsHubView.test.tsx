import { describe, expect, test } from 'bun:test';
import { render, screen } from '@testing-library/react';

import { installI18nMock } from '../../helpers/i18n';

installI18nMock();

import DocsHubView from '../../../components/docs/DocsHubView';

describe('<DocsHubView />', () => {
  test('uses the localized documentation hub title', () => {
    render(<DocsHubView />);

    expect(screen.getByRole('heading', { name: 'docsHub.title' })).toBeDefined();
  });

  test('links to the frontend, backend, and app documentation targets', () => {
    render(<DocsHubView />);

    expect(screen.getByRole('link', { name: /frontend/i }).getAttribute('href')).toBe(
      '/docs/frontend/index.html',
    );
    expect(screen.getByRole('link', { name: /backend/i }).getAttribute('href')).toBe('/docs/api');
    expect(screen.getByRole('link', { name: /app/i }).getAttribute('href')).toBe(
      '/docs/index.html',
    );
  });
});

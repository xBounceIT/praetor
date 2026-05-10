import { describe, expect, test } from 'bun:test';
import { render, screen } from '@testing-library/react';

import DocsHubView from '../../../components/docs/DocsHubView';

describe('<DocsHubView />', () => {
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

import { describe, expect, test } from 'bun:test';
import { screen } from '@testing-library/react';
import { Input } from '../../../components/ui/input';
import { render } from '../../helpers/render';

describe('<Input />', () => {
  test('uses a theme-aware native picker color scheme for time inputs', () => {
    render(<Input aria-label="Start time" type="time" />);

    const input = screen.getByLabelText('Start time');

    expect(input.className).toContain('[color-scheme:light]');
    expect(input.className).toContain('dark:[color-scheme:dark]');
  });

  test('does not add native picker color-scheme classes to regular inputs', () => {
    render(<Input aria-label="Name" />);

    expect(screen.getByLabelText('Name').className).not.toContain('color-scheme');
  });
});

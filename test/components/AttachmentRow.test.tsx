import { describe, expect, test } from 'bun:test';
import { screen } from '@testing-library/react';
import { render } from '../helpers/render';

const AttachmentRow = (await import('../../components/sales/AttachmentRow')).default;

describe('<AttachmentRow />', () => {
  test('renders the file name, meta sub-line, and trailing actions', () => {
    render(
      <ul>
        <AttachmentRow
          fileName="report.pdf"
          meta="2.0 KB · uploaded today"
          actions={
            <button type="button" aria-label="Download">
              dl
            </button>
          }
        />
      </ul>,
    );

    expect(screen.getByText('report.pdf')).toBeInTheDocument();
    expect(screen.getByText('2.0 KB · uploaded today')).toBeInTheDocument();
    expect(screen.getByLabelText('Download')).toBeInTheDocument();
  });
});

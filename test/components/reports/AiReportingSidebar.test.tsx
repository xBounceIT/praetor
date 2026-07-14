import { describe, expect, mock, test } from 'bun:test';
import { fireEvent, render, screen } from '@testing-library/react';
import { AiReportingSidebar } from '@/components/reports/AiReportingView';
import type { ReportChatSessionSummary } from '@/types';

const t = (key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? key;

const sessions: ReportChatSessionSummary[] = [
  {
    id: 'revenue',
    title: 'Quarterly revenue',
    createdAt: Date.now(),
    updatedAt: Date.now(),
  },
  {
    id: 'capacity',
    title: 'Project capacity',
    createdAt: Date.now() - 86_400_000,
    updatedAt: Date.now() - 86_400_000,
  },
];

describe('<AiReportingSidebar />', () => {
  test('filters chats and selects a visible result', () => {
    const onSelectSession = mock(() => {});

    render(
      <AiReportingSidebar
        t={t as never}
        sessions={sessions}
        activeSessionId="revenue"
        isLoadingSessions={false}
        isCreatingSession={false}
        isNewChatDisabled={false}
        onSelectSession={onSelectSession}
        onNewChat={() => {}}
      />,
    );

    fireEvent.change(screen.getByRole('textbox', { name: 'Search chats...' }), {
      target: { value: 'CAPACITY' },
    });

    expect(screen.queryByText('Quarterly revenue')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Project capacity/i }));
    expect(onSelectSession).toHaveBeenCalledWith('capacity');
  });

  test('starts a new chat from the persistent footer action', () => {
    const onNewChat = mock(() => {});

    render(
      <AiReportingSidebar
        t={t as never}
        sessions={sessions}
        activeSessionId="revenue"
        isLoadingSessions={false}
        isCreatingSession={false}
        isNewChatDisabled={false}
        onSelectSession={() => {}}
        onNewChat={onNewChat}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'New Chat' }));
    expect(onNewChat).toHaveBeenCalledTimes(1);
  });
});

export type TimesheetLoadRequirements = Readonly<{
  entries: boolean;
  clients: boolean;
  projects: boolean;
  tasks: boolean;
  users: boolean;
}>;

const NONE: TimesheetLoadRequirements = {
  entries: false,
  clients: false,
  projects: false,
  tasks: false,
  users: false,
};

/** Returns the shared app datasets that must be ready before a timesheet route can mount. */
export const getTimesheetLoadRequirements = (view: string): TimesheetLoadRequirements => {
  switch (view) {
    case 'timesheets/tracker':
      return { entries: true, clients: true, projects: true, tasks: true, users: true };
    case 'timesheets/ril':
      // RIL loads its month entries, draft, and lightweight project catalog in RilView.
      return { ...NONE, users: true };
    case 'timesheets/recurring':
      return { ...NONE, clients: true, projects: true, tasks: true };
    default:
      return NONE;
  }
};

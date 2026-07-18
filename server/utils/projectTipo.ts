// Project `tipo` (issue #784): a mandatory single-choice marker classifying a project as
// `attivo` (active/revenue), `passivo` (passive/cost), or `interno` (internal work without
// commercial links). Stored lowercase in the DB and translated for display, mirroring the
// billing-type convention. `tipo_confirmed` tracks
// whether the value was explicitly chosen by a user (true for projects created after the
// feature shipped) versus defaulted by the rollout migration (false) — the edit form forces
// a deliberate choice on the first edit of a defaulted project before it can be saved.

export const PROJECT_TIPOS = ['attivo', 'passivo', 'interno'] as const;

export type ProjectTipo = (typeof PROJECT_TIPOS)[number];

export const DEFAULT_PROJECT_TIPO: ProjectTipo = 'attivo';

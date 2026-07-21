import type { RevisionCodeTemplate } from '../../types';
import { fetchApi } from './client';

export type RevisionCodeTemplateUpdate = Pick<
  RevisionCodeTemplate,
  'prefix' | 'template' | 'sequencePadding'
>;

export const revisionCodeTemplateApi = {
  get: (): Promise<RevisionCodeTemplate> =>
    fetchApi<RevisionCodeTemplate>('/revision-code-template'),

  update: (template: RevisionCodeTemplateUpdate): Promise<RevisionCodeTemplate> =>
    fetchApi<RevisionCodeTemplate>('/revision-code-template', {
      method: 'PUT',
      body: JSON.stringify(template),
    }),
};

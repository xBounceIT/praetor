import type {
  BillingFrequency,
  ClientsOrder,
  Project,
  ProjectStatus,
  ProjectTipo,
  RilProjectReference,
  StoredBillingType,
} from '../../types';
import { fetchApi } from './client';
import { normalizeProject } from './normalizers';

type ProjectOrderOptionResponse = Pick<
  ClientsOrder,
  'id' | 'clientId' | 'clientName' | 'status' | 'createdAt' | 'updatedAt'
>;

const normalizeProjectOrderOption = (order: ProjectOrderOptionResponse): ClientsOrder => ({
  ...order,
  items: [],
  paymentTerms: 'immediate',
  discount: 0,
  discountType: 'percentage',
});

export const projectsApi = {
  list: (filters: { userId?: string } = {}): Promise<Project[]> => {
    const params = new URLSearchParams();
    if (filters.userId) params.set('userId', filters.userId);
    const query = params.toString();
    return fetchApi<Project[]>(`/projects${query ? `?${query}` : ''}`).then((projects) =>
      projects.map(normalizeProject),
    );
  },

  listRilCatalog: (userId: string): Promise<RilProjectReference[]> => {
    const params = new URLSearchParams({ userId });
    return fetchApi<RilProjectReference[]>(`/projects/ril-catalog?${params.toString()}`);
  },

  listOrderOptions: (): Promise<ClientsOrder[]> =>
    fetchApi<ProjectOrderOptionResponse[]>('/projects/order-options').then((orders) =>
      orders.map(normalizeProjectOrderOption),
    ),

  create: (data: {
    name: string;
    clientId: string;
    description?: string | null;
    orderId?: string | null;
    offerId?: string | null;
    startDate?: string | null;
    endDate?: string | null;
    revenue?: number | null;
    billingType?: StoredBillingType;
    billingFrequency?: BillingFrequency;
    status: ProjectStatus;
    tipo: ProjectTipo;
  }): Promise<Project> =>
    fetchApi<Project>('/projects', {
      method: 'POST',
      body: JSON.stringify(data),
    }).then(normalizeProject),

  update: (id: string, updates: Partial<Project>): Promise<Project> =>
    fetchApi<Project>(`/projects/${id}`, {
      method: 'PUT',
      body: JSON.stringify(updates),
    }).then(normalizeProject),

  delete: (id: string): Promise<void> => fetchApi(`/projects/${id}`, { method: 'DELETE' }),

  getUsers: (id: string, signal?: AbortSignal): Promise<string[]> =>
    fetchApi(`/projects/${id}/users`, { signal }),

  updateUsers: (id: string, userIds: string[]): Promise<void> =>
    fetchApi(`/projects/${id}/users`, {
      method: 'POST',
      body: JSON.stringify({ userIds }),
    }),
};

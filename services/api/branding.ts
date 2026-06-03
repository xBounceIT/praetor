import type { AppBranding } from '../../types';
import { fetchApi, fetchApiStream, getApiBase } from './client';

// Raw server shape. The client derives a ready-to-render `logoUrl` from `hasLogo` +
// `logoUpdatedAt` (the latter doubles as a cache-busting version) so consumers never
// have to know the logo endpoint or stitch query params together.
interface BrandingResponse {
  companyName: string | null;
  hasLogo: boolean;
  logoUpdatedAt: string | null;
}

const toBranding = (response: BrandingResponse): AppBranding => ({
  companyName: response.companyName ?? null,
  logoUrl: response.hasLogo
    ? `${getApiBase()}/branding/logo?v=${encodeURIComponent(response.logoUpdatedAt ?? '')}`
    : null,
});

export const brandingApi = {
  // Unauthenticated — used by the login screen and on app boot before a user exists.
  getPublic: (): Promise<AppBranding> => fetchApi<BrandingResponse>('/branding').then(toBranding),

  updateName: (companyName: string | null): Promise<AppBranding> =>
    fetchApi<BrandingResponse>('/branding', {
      method: 'PUT',
      body: JSON.stringify({ companyName }),
    }).then(toBranding),

  uploadLogo: async (file: File): Promise<AppBranding> => {
    const formData = new FormData();
    formData.append('file', file, file.name);
    // fetchApiStream (not fetchApi) so the browser sets the multipart boundary itself.
    const response = await fetchApiStream('/branding/logo', {
      method: 'POST',
      body: formData,
    });
    return toBranding((await response.json()) as BrandingResponse);
  },

  deleteLogo: (): Promise<AppBranding> =>
    fetchApi<BrandingResponse>('/branding/logo', {
      method: 'DELETE',
    }).then(toBranding),
};

import { toast } from 'sonner';

export const toastError = (message: string) => toast.error(message);

export const toastSuccess = (message: string) => toast.success(message);

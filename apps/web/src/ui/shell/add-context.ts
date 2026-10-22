'use client';

import { createContext, useContext } from 'react';

// How any screen opens the add sheet (FR-007) without importing it: the shell's AddSheetHost provides the function.
export interface AddRequest {
  type?: 'expense' | 'income' | 'transfer' | undefined;
  accountId?: string | undefined;
}
export interface AddApi {
  openAdd(request?: AddRequest): void;
}
export const AddContext = createContext<AddApi>({ openAdd: () => undefined });
export const useAddSheet = (): AddApi => useContext(AddContext);

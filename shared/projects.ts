/** Metadados do cadastro de uma pasta; nenhum conteúdo de arquivo é transportado. */
export interface RegisteredProject {
  path: string;
  createdAt: number;
}

export interface ProjectFolderView {
  path: string;
  parent: string | null;
  folders: Array<{ name: string; path: string }>;
  truncated: boolean;
  roots?: ProjectFolder[];
}

export interface ProjectFolder { name: string; path: string; }

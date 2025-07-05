export type Plugin = {
  id: string;
  createdAt: number;
  name: string;
  toolName?: string;
  lang: string;
  description: string;
  builtin: boolean;
  enable: boolean;
  onlyNodeRuntime: boolean;

  title?: string;
  version?: string;
  content?: string;
  authType?: string;
  authLocation?: string;
  authHeader?: string;
  authToken?: string;
};

export type BuiltinPlugin = Omit<Plugin, "id"> & {
  builtin: Boolean;
};

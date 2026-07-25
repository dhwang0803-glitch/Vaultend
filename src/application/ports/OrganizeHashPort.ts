import { NotePath } from '../../domain/values/NotePath';

export interface OrganizeHashPort {
  getHash(notePath: NotePath): Promise<string | null>;
  setHash(notePath: NotePath, hash: string): Promise<void>;
  removeHash(notePath: NotePath): Promise<void>;
  persist(): Promise<void>;
}

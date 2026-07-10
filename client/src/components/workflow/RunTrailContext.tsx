// Rastro da última execução (nodeId → desfecho), para o nó customizado do React
// Flow pintar o caminho no canvas. Vive num context porque os nós só recebem
// `data` — não dá para passar props até eles (mesmo padrão do WorkflowMetaContext).
// `null` = destaque desligado.
import { createContext, useContext } from 'react';

export type RunTrail = Record<string, string> | null;

const Ctx = createContext<RunTrail>(null);

export const useRunTrail = () => useContext(Ctx);
export const RunTrailProvider = Ctx.Provider;

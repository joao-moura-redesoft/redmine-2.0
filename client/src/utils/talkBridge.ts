// Bridge leve entre IssueModal e TalkChat.
// TalkChat registra um uploader quando há sala ativa;
// IssueModal chama shareFiles após postar um comentário com anexos.

type Uploader = (file: File) => Promise<void>;

let _uploader: Uploader | null = null;

export const talkBridge = {
  register: (fn: Uploader | null) => {
    _uploader = fn;
  },
  hasReceiver: () => !!_uploader,
  shareFile: async (file: File): Promise<boolean> => {
    if (!_uploader) return false;
    try {
      await _uploader(file);
      return true;
    } catch {
      return false;
    }
  },
};

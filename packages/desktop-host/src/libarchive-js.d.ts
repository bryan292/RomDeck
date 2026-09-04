declare module "libarchive.js/dist/libarchive-node.mjs" {
  export const Archive: {
    open(file: File): Promise<{
      getFilesArray(): Promise<Array<{
        file: null | {
          name: string;
          size: number;
          extract(): Promise<File>;
        };
        path: string;
      }>>;
      close(): Promise<void>;
    }>;
  };
}

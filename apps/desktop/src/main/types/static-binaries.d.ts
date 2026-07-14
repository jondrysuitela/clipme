declare module "ffmpeg-static" {
  const path: string | null;
  export = path;
}

declare module "ffprobe-static" {
  const ffprobe: {
    path: string;
    version?: string;
    url?: string;
  };
  export = ffprobe;
}

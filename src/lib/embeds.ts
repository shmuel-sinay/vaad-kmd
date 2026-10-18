// Videos from "החתול השחור" can be pasted as the direct video address and are played in the chat, straight from the
// source in the viewer's own browser (nothing passes through or is stored by this site). Only this exact address shape is
// accepted; any other link stays a plain link. A page link of the source (black-cat.thechats.click/#id) is not enough
// to find the video, so the direct video address is needed.
const CDN_VIDEO = /https:\/\/cdn\.thechats\.click\/[0-9a-f]{2}\/[0-9a-f]{2}\/[0-9a-f]{64}\.mp4/g;

export function embedsOf(body: string | null | undefined): string[] {
  if (!body) return [];
  return [...new Set(body.match(CDN_VIDEO) ?? [])].slice(0, 2);
}

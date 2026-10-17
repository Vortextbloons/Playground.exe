export type AvatarSpec = { face: string; hue: number };

const FACES = ['🦊', '🐼', '🐸', '🦁', '🐙', '🦄', '🐯', '🐵', '🐺', '🦖', '🐳', '🦅', '🐝', '🦉', '🐲', '🦋'];

export function avatarFor(id: string): AvatarSpec {
  let hash = 2166136261;
  for (let index = 0; index < id.length; index += 1) {
    hash ^= id.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  hash >>>= 0;
  return { face: FACES[hash % FACES.length]!, hue: hash % 360 };
}

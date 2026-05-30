import { timingSafeEqual } from 'node:crypto';

export function parseBearerToken(authHeader: string | undefined): string | null {
	const parts = authHeader?.split(' ');
	return parts?.length === 2 && parts[0] === 'Bearer' && parts[1] ? parts[1] : null;
}

export function tokenEquals(a: string, b: string): boolean {
	const bufA = Buffer.from(a, 'utf8');
	const bufB = Buffer.from(b, 'utf8');
	if (bufA.length !== bufB.length) return false;
	return timingSafeEqual(bufA, bufB);
}

export function hasStaticBearerToken(
	authHeader: string | undefined,
	requiredToken: string,
): boolean {
	const bearerToken = parseBearerToken(authHeader);
	return bearerToken !== null && tokenEquals(bearerToken, requiredToken);
}

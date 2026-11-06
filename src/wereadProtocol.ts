/** Agent protocol version verified against the official weread-skills 1.0.5 archive.
 * Both gateway entry points must advance together; do not infer or auto-accept
 * a server version without reviewing its matching capability documentation.
 */
export const WEREAD_SKILL_VERSION = '1.0.5';

export class WereadUpgradeRequiredError extends Error {
	constructor(latestVersion?: string) {
		super(
			`微信读书接口${latestVersion ? `要求 Skill ${latestVersion}` : '要求更新 Skill 版本'}，请更新微信读书插件后重试。`
		);
		this.name = 'WereadUpgradeRequiredError';
	}
}

/** Never display raw upstream instructions as actionable plugin UI copy. */
export function assertWereadProtocol(response: unknown): void {
	if (!response || typeof response !== 'object') return;
	const upgrade = (response as { upgrade_info?: unknown }).upgrade_info;
	if (!upgrade) return;
	const version =
		typeof upgrade === 'object'
			? (upgrade as { latest_version?: unknown }).latest_version
			: undefined;
	throw new WereadUpgradeRequiredError(
		typeof version === 'string' && /^\d+\.\d+\.\d+$/.test(version) ? version : undefined
	);
}

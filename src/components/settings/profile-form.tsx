"use client";

import { memo, useState } from "react";
import { updateProfile, uploadAvatar } from "@/app/actions/settings";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PROFILE_ROLES } from "@/lib/constants";

export const ProfileForm = memo(function ProfileForm({
	profile,
}: {
	profile: {
		full_name: string | null;
		avatar_url: string | null;
		email: string;
		role: string | null;
	};
}) {
	const [uploading, setUploading] = useState(false);
	const [avatarError, setAvatarError] = useState<string | null>(null);
	// Legacy rows may carry a role outside the current list; fall back to
	// "other" so the next save normalizes instead of failing validation.
	const initialRole = (PROFILE_ROLES as readonly string[]).includes(
		profile.role ?? "",
	)
		? (profile.role as (typeof PROFILE_ROLES)[number])
		: "other";

	return (
		<div className="space-y-8">
			<div className="flex items-center gap-4">
				<div className="relative shrink-0">
					{profile.avatar_url ? (
						<img
							src={profile.avatar_url}
							alt="Avatar"
							width={64}
							height={64}
							className="h-16 w-16 rounded-full object-cover"
						/>
					) : (
						<div className="flex h-16 w-16 items-center justify-center rounded-full bg-(--bg-surface) text-2xl text-(--text-secondary)">
							{profile.full_name?.charAt(0) || profile.email.charAt(0)}
						</div>
					)}
					<label className="absolute -bottom-1 -right-1 flex h-7 w-7 cursor-pointer items-center justify-center rounded-full btn-primary text-xs shadow hover:bg-text-gray">
						+
						<input
							type="file"
							name="avatar"
							accept="image/jpeg,image/png,image/webp"
							disabled={uploading}
							className="hidden"
							onChange={async (e) => {
								const file = e.target.files?.[0];
								if (!file) return;
								setAvatarError(null);
								if (file.size > 5 * 1024 * 1024) {
									setAvatarError("Ukuran avatar maksimal 5MB.");
									return;
								}

								setUploading(true);
								try {
									const fd = new FormData();
									fd.append("avatar", file);
									await uploadAvatar(fd);
								} catch {
									setAvatarError("Upload avatar belum tersedia.");
								} finally {
									setUploading(false);
								}
							}}
						/>
					</label>
				</div>

				<div>
					<h2 className="font-inter font-[510] text-lg font-bold">
						{profile.full_name || "User"}
					</h2>
					<p className="mt-1 text-sm text-(--text-secondary)">
						{profile.email}
					</p>
					{avatarError && (
						<p role="alert" className="mt-1 text-xs text-red-500">
							{avatarError}
						</p>
					)}
				</div>
			</div>

			<form action={updateProfile} className="space-y-5">
				<div>
					<label
						htmlFor="profile-full-name"
						className="mb-1 block text-sm font-medium"
					>
						Nama Lengkap
					</label>
					<Input
						id="profile-full-name"
						name="full_name"
						defaultValue={profile.full_name || ""}
						placeholder="Nama lengkap kamu"
					/>
				</div>

				<div>
					<label
						htmlFor="profile-role-select"
						className="mb-1 block text-sm font-medium"
					>
						Peran
					</label>
					<select
						id="profile-role-select"
						name="role"
						defaultValue={initialRole}
						className="h-11 w-full rounded-lg border border-(--border-subtle) bg-(--bg-card) px-4 text-sm focus:border-primary-black focus:outline-none focus:ring-2 focus:ring-primary-black/5"
					>
						<option value="pm">Product Manager</option>
						<option value="developer">Software Developer</option>
						<option value="founder">Startup Founder / CTO</option>
						<option value="designer">UX/UI Designer</option>
						<option value="student">Mahasiswa / Fresh Graduate</option>
						<option value="other">Lainnya</option>
					</select>
				</div>

				<Button type="submit">Simpan Perubahan</Button>
			</form>
		</div>
	);
});

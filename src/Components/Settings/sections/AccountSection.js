import React, { useContext, useState, useEffect } from "react";
import {
  SubHeading3,
  Button,
  FontAwesomeIcon,
  DataList,
} from "@trops/dash-react";
import { AppContext } from "../../../Context/App/AppContext";

export const AccountSection = ({
  authStatus,
  authProfile,
  onSignIn,
  onSignOut,
  onProfileUpdated,
}) => {
  return (
    <div className="flex flex-col space-y-6">
      {authStatus !== "authenticated" || !authProfile ? (
        <UnauthenticatedView onSignIn={onSignIn} />
      ) : (
        <AuthenticatedView
          profile={authProfile}
          onSignOut={onSignOut}
          onProfileUpdated={onProfileUpdated}
        />
      )}
      {/* "Check for updates" lives at the section bottom so it's
          available regardless of auth state — the user can trigger
          a manual app-updates check (widgets + dashboards) without
          needing to be signed in to the registry. */}
      <AppUpdatesTrigger />
    </div>
  );
};

const AppUpdatesTrigger = () => {
  const appContext = useContext(AppContext);
  const triggerAppUpdatesCheck = appContext?.triggerAppUpdatesCheck;
  if (typeof triggerAppUpdatesCheck !== "function") return null;
  return (
    <div className="flex flex-col space-y-3">
      <SubHeading3 title="App updates" padding={false} />
      <div className="flex flex-row items-center justify-between py-3">
        <div className="flex flex-col">
          <span className="text-sm font-medium">Check for updates</span>
          <span className="text-xs opacity-50">
            Look up newer versions of installed widget packages and dashboards
            on the registry. Opens the updates dialog with the result.
          </span>
        </div>
        <Button
          title="Check for updates"
          onClick={() => triggerAppUpdatesCheck()}
        />
      </div>
    </div>
  );
};

const UnauthenticatedView = ({ onSignIn }) => (
  <div className="flex flex-col items-center justify-center py-16 space-y-4">
    <FontAwesomeIcon icon="circle-user" className="h-12 w-12 opacity-30" />
    <div className="text-center space-y-1">
      <p className="text-sm font-medium">Not signed in</p>
      <p className="text-xs opacity-50">
        Sign in to manage your profile and published packages
      </p>
    </div>
    <Button title="Sign In" onClick={onSignIn} />
  </div>
);

const AuthenticatedView = ({ profile, onSignOut, onProfileUpdated }) => {
  const [packages, setPackages] = useState([]);
  const [loadingPackages, setLoadingPackages] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function loadPackages() {
      try {
        const result = await window.mainApi?.registryAuth?.getPackages();
        if (!cancelled && result?.packages) {
          setPackages(result.packages);
        }
      } catch {
        // ignore
      } finally {
        if (!cancelled) setLoadingPackages(false);
      }
    }
    loadPackages();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="flex flex-col space-y-6">
      <ProfileCard
        profile={profile}
        onSignOut={onSignOut}
        onProfileUpdated={onProfileUpdated}
      />
      <PackagesList
        packages={packages}
        loading={loadingPackages}
        onPackageUpdated={(updatedPkg) => {
          setPackages((prev) =>
            prev.map((p) =>
              p.name === updatedPkg.name && p.scope === updatedPkg.scope
                ? { ...p, ...updatedPkg }
                : p,
            ),
          );
        }}
        onPackageDeleted={(deletedPkg) => {
          setPackages((prev) =>
            prev.filter(
              (p) =>
                !(p.name === deletedPkg.name && p.scope === deletedPkg.scope),
            ),
          );
        }}
      />
    </div>
  );
};

const ProfileCard = ({ profile, onSignOut, onProfileUpdated }) => {
  const [editing, setEditing] = useState(false);
  const [displayName, setDisplayName] = useState(profile.displayName || "");
  const [saving, setSaving] = useState(false);

  const initial = (profile.displayName || profile.username || "?")
    .charAt(0)
    .toUpperCase();
  const memberSince = profile.createdAt
    ? new Date(profile.createdAt).toLocaleDateString("en-US", {
        year: "numeric",
        month: "long",
      })
    : null;

  async function handleSave() {
    setSaving(true);
    try {
      const result = await window.mainApi?.registryAuth?.updateProfile({
        displayName,
      });
      if (result) {
        setEditing(false);
        onProfileUpdated?.();
      }
    } catch {
      // ignore
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-col space-y-3">
      <SubHeading3 title="Profile" padding={false} />
      <div className="flex items-start gap-4">
        <div className="flex-shrink-0 w-12 h-12 rounded-full bg-white/10 flex items-center justify-center text-lg font-bold opacity-70">
          {initial}
        </div>
        <div className="flex-1 min-w-0 space-y-1">
          {editing ? (
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                className="bg-white/5 border border-white/10 rounded px-2 py-1 text-sm flex-1 min-w-0 focus:outline-none focus:border-white/30"
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleSave();
                  if (e.key === "Escape") setEditing(false);
                }}
              />
              <Button
                title={saving ? "Saving..." : "Save"}
                onClick={handleSave}
                disabled={saving}
              />
              <button
                type="button"
                onClick={() => setEditing(false)}
                className="text-xs opacity-50 hover:opacity-80 cursor-pointer"
              >
                Cancel
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium">
                {profile.displayName || profile.username}
              </span>
              <button
                type="button"
                onClick={() => {
                  setDisplayName(profile.displayName || "");
                  setEditing(true);
                }}
                className="opacity-40 hover:opacity-80 cursor-pointer"
              >
                <FontAwesomeIcon icon="pen" className="h-2.5 w-2.5" />
              </button>
            </div>
          )}
          <span className="text-xs opacity-50">@{profile.username}</span>
          {memberSince && (
            <span className="text-xs opacity-40 block">
              Member since {memberSince}
            </span>
          )}
        </div>
      </div>
      <div className="pt-2">
        <button
          type="button"
          onClick={onSignOut}
          className="text-xs opacity-50 hover:opacity-80 cursor-pointer"
        >
          Sign Out
        </button>
      </div>
    </div>
  );
};

const PackagesList = ({
  packages,
  loading,
  onPackageUpdated,
  onPackageDeleted,
}) => {
  const [editingPkg, setEditingPkg] = useState(null);

  if (loading) {
    return (
      <div className="flex flex-col space-y-3">
        <SubHeading3 title="Published Packages" padding={false} />
        <span className="text-xs opacity-50">Loading...</span>
      </div>
    );
  }

  return (
    <div className="flex flex-col space-y-3">
      <SubHeading3 title="Published Packages" padding={false} />
      {packages.length === 0 ? (
        <span className="text-xs opacity-50">No published packages yet</span>
      ) : (
        <div className="flex flex-col space-y-2">
          {packages.map((pkg) => (
            <PackageItem
              key={`${pkg.scope}/${pkg.name}`}
              pkg={pkg}
              isEditing={editingPkg === `${pkg.scope}/${pkg.name}`}
              onEdit={() => setEditingPkg(`${pkg.scope}/${pkg.name}`)}
              onCancel={() => setEditingPkg(null)}
              onSaved={(updated) => {
                setEditingPkg(null);
                onPackageUpdated(updated);
              }}
              onDeleted={() => {
                setEditingPkg(null);
                onPackageDeleted(pkg);
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
};

const PackageItem = ({
  pkg,
  isEditing,
  onEdit,
  onCancel,
  onSaved,
  onDeleted,
}) => {
  const [form, setForm] = useState({
    displayName: pkg.displayName || "",
    description: pkg.description || "",
    category: pkg.category || "",
    tags: (pkg.tags || []).join(", "),
    visibility: pkg.visibility || "public",
  });
  const [saving, setSaving] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  // Last delete-attempt error. Rendered inline next to the delete
  // button so a failed attempt surfaces its cause (auth expired, 404,
  // server 500, network) instead of silently resetting.
  const [deleteError, setDeleteError] = useState(null);

  async function handleSave() {
    setSaving(true);
    try {
      const updates = {
        displayName: form.displayName,
        description: form.description,
        category: form.category,
        tags: form.tags
          .split(",")
          .map((t) => t.trim())
          .filter(Boolean),
        visibility: form.visibility,
      };
      const result = await window.mainApi?.registryAuth?.updatePackage(
        pkg.scope,
        pkg.name,
        updates,
      );
      if (result) {
        onSaved({ ...pkg, ...updates });
      }
    } catch {
      // ignore
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    setDeleting(true);
    setDeleteError(null);
    try {
      const result = await window.mainApi?.registryAuth?.deletePackage(
        pkg.scope,
        pkg.name,
      );
      if (result?.success) {
        onDeleted?.();
        return;
      }
      // New error-surface format: `{ success, error, status }`. Show
      // the server-reported reason so the user (or the next bug
      // reporter) knows exactly why the delete failed.
      setDeleteError(
        result?.error ||
          (result?.status
            ? `Delete failed (${result.status})`
            : "Delete failed — no response from registry."),
      );
    } catch (err) {
      setDeleteError(`Unexpected error: ${err?.message || String(err)}`);
    } finally {
      setDeleting(false);
      setConfirmingDelete(false);
    }
  }

  const updatedAt = pkg.updatedAt
    ? new Date(pkg.updatedAt).toLocaleDateString()
    : null;

  if (isEditing) {
    return (
      <div className="bg-white/5 rounded-lg p-3 space-y-3">
        <div className="space-y-2">
          <EditField
            label="Display Name"
            value={form.displayName}
            onChange={(v) => setForm({ ...form, displayName: v })}
          />
          <EditField
            label="Description"
            value={form.description}
            onChange={(v) => setForm({ ...form, description: v })}
          />
          <EditField
            label="Category"
            value={form.category}
            onChange={(v) => setForm({ ...form, category: v })}
          />
          <EditField
            label="Tags (comma-separated)"
            value={form.tags}
            onChange={(v) => setForm({ ...form, tags: v })}
          />
          <div className="flex flex-col space-y-1">
            <span className="text-xs opacity-50">Visibility</span>
            <select
              value={form.visibility}
              onChange={(e) =>
                setForm({
                  ...form,
                  visibility: e.target.value,
                })
              }
              className="bg-white/5 border border-white/10 rounded px-2 py-1 text-sm focus:outline-none focus:border-white/30"
            >
              <option value="public">Public</option>
              <option value="private">Private</option>
            </select>
          </div>
        </div>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            {confirmingDelete ? (
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleDelete}
                  disabled={deleting}
                  className="text-xs text-red-400 hover:text-red-300 cursor-pointer font-medium"
                >
                  {deleting ? "Deleting..." : "Confirm Delete"}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setConfirmingDelete(false);
                    setDeleteError(null);
                  }}
                  className="text-xs opacity-50 hover:opacity-80 cursor-pointer"
                >
                  Cancel
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => {
                  setConfirmingDelete(true);
                  setDeleteError(null);
                }}
                className="text-xs text-red-400/70 hover:text-red-400 cursor-pointer"
              >
                Delete
              </button>
            )}
            {deleteError && (
              <span
                className="text-[11px] text-red-400 max-w-sm truncate"
                title={deleteError}
              >
                {deleteError}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onCancel}
              className="text-xs opacity-50 hover:opacity-80 cursor-pointer"
            >
              Cancel
            </button>
            <Button
              title={saving ? "Saving..." : "Save"}
              onClick={handleSave}
              disabled={saving}
            />
          </div>
        </div>
      </div>
    );
  }

  const isPrivate = pkg.visibility === "private";

  function openAccessPage(e) {
    e.stopPropagation();
    // Registry web URL. If we ever move off Amplify Hosting's default
    // domain this centralizes nicely into a config, but hardcoded is
    // consistent with how other files in the app already reference it.
    const url = `https://main.d919rwhuzp7rj.amplifyapp.com/package/${encodeURIComponent(
      pkg.scope,
    )}/${encodeURIComponent(pkg.name)}/access`;
    window.mainApi?.shell?.openExternal(url);
  }

  return (
    <div
      onClick={onEdit}
      className="bg-white/5 rounded-lg p-3 cursor-pointer hover:bg-white/10 transition-colors"
    >
      <div className="space-y-1">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium truncate">
            {pkg.displayName || pkg.name}
          </span>
          {pkg.version && (
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-white/10 opacity-60">
              v{pkg.version}
            </span>
          )}
          <span
            className={`text-[10px] px-1.5 py-0.5 rounded ${
              isPrivate
                ? "bg-amber-500/20 text-amber-300"
                : "bg-emerald-500/20 text-emerald-300"
            }`}
          >
            {pkg.visibility || "public"}
          </span>
          {isPrivate && (
            <button
              type="button"
              onClick={openAccessPage}
              title="Open the access management page in your browser"
              className="ml-auto text-[10px] px-2 py-0.5 rounded border border-indigo-500/40 text-indigo-300 hover:text-white hover:bg-indigo-600/20 transition-colors"
            >
              Manage access &rarr;
            </button>
          )}
        </div>
        {pkg.description && (
          <p className="text-xs opacity-50 truncate">{pkg.description}</p>
        )}
        {updatedAt && (
          <span className="text-[10px] opacity-40">Updated {updatedAt}</span>
        )}
      </div>
    </div>
  );
};

const EditField = ({ label, value, onChange }) => (
  <div className="flex flex-col space-y-1">
    <span className="text-xs opacity-50">{label}</span>
    <input
      type="text"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="bg-white/5 border border-white/10 rounded px-2 py-1 text-sm focus:outline-none focus:border-white/30"
    />
  </div>
);

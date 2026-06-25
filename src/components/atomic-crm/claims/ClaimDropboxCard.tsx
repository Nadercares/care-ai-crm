import { useCallback, useEffect, useState } from "react";
import { useRecordContext, useNotify } from "ra-core";
import {
  Folder,
  Loader2,
  RefreshCw,
  ExternalLink,
  FolderOpen,
  Settings,
  Box,
} from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

import { getSupabaseClient } from "../providers/supabase/supabase";

interface Claim {
  id: number;
}

interface FileEntry {
  id: string;
  name: string;
  path: string;
  kind: "file" | "folder" | "deleted";
  size: number | null;
  modified_at: string | null;
  file_kind: string | null;
  preview_url: string;
}

const FILE_KIND_LABEL: Record<string, string> = {
  policy: "Policy",
  estimate: "Estimate",
  report: "Report",
  correspondence: "Correspondence",
  contract: "Contract",
  photo: "Photo",
  video: "Video",
  spreadsheet: "Spreadsheet",
  document: "Document",
  email: "Email",
  other: "Other",
};

const DROPBOX_SCOPES = ["files.metadata.read", "files.content.read"];

function buildAuthUrl(authUserId: string, claimId: number | null): string {
  const clientId = import.meta.env.VITE_DROPBOX_CLIENT_ID as string | undefined;
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string;
  if (!clientId) {
    throw new Error("VITE_DROPBOX_CLIENT_ID is not set on the frontend.");
  }
  const redirectUri = `${supabaseUrl.replace(/\/$/, "")}/functions/v1/dropbox-oauth-callback`;
  const state = claimId ? `${authUserId}|${claimId}` : authUserId;
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    token_access_type: "offline",
    scope: DROPBOX_SCOPES.join(" "),
    state,
  });
  return `https://www.dropbox.com/oauth2/authorize?${params.toString()}`;
}

export function ClaimDropboxCard() {
  const claim = useRecordContext<Claim>();
  const notify = useNotify();

  const [connection, setConnection] = useState<{
    id: number;
    dropbox_email: string;
  } | null>(null);
  const [folderPath, setFolderPath] = useState<string | null>(null);
  const [entries, setEntries] = useState<FileEntry[]>([]);
  const [loadingConnection, setLoadingConnection] = useState(true);
  const [loadingFiles, setLoadingFiles] = useState(false);
  const [showFolderDialog, setShowFolderDialog] = useState(false);
  const [folderInput, setFolderInput] = useState("");

  const claimId = claim?.id;

  // Load connection + folder link on mount.
  useEffect(() => {
    if (!claimId) return;
    let cancelled = false;
    (async () => {
      const supabase = getSupabaseClient();
      setLoadingConnection(true);
      const [{ data: conn }, { data: link }] = await Promise.all([
        supabase
          .from("dropbox_connections")
          .select("id, dropbox_email")
          .limit(1)
          .maybeSingle(),
        supabase
          .from("claim_dropbox_folders")
          .select("folder_path")
          .eq("claim_id", claimId)
          .maybeSingle(),
      ]);
      if (cancelled) return;
      setConnection(conn ?? null);
      setFolderPath(link?.folder_path ?? null);
      setFolderInput(link?.folder_path ?? "");
      setLoadingConnection(false);

      // Surface OAuth callback results from the URL params.
      const url = new URL(window.location.href);
      if (url.searchParams.get("dropbox_connected")) {
        notify("Dropbox connected.", { type: "success" });
        url.searchParams.delete("dropbox_connected");
        window.history.replaceState(null, "", url.toString());
      }
      const err = url.searchParams.get("dropbox_error");
      if (err) {
        notify(`Dropbox connect failed: ${err}`, { type: "error" });
        url.searchParams.delete("dropbox_error");
        window.history.replaceState(null, "", url.toString());
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [claimId, notify]);

  const loadFiles = useCallback(async () => {
    if (!claimId || !connection || !folderPath) {
      setEntries([]);
      return;
    }
    setLoadingFiles(true);
    try {
      const supabase = getSupabaseClient();
      const { data: session } = await supabase.auth.getSession();
      const token = session?.session?.access_token;
      if (!token) throw new Error("Not signed in.");
      const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/dropbox-list`;
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ claim_id: claimId }),
      });
      const payload = await res.json();
      if (!res.ok) throw new Error(payload?.error || `HTTP ${res.status}`);
      setEntries(payload.entries ?? []);
    } catch (err) {
      notify(err instanceof Error ? err.message : String(err), {
        type: "error",
      });
      setEntries([]);
    } finally {
      setLoadingFiles(false);
    }
  }, [claimId, connection, folderPath, notify]);

  useEffect(() => {
    void loadFiles();
  }, [loadFiles]);

  const startOauth = async () => {
    try {
      const supabase = getSupabaseClient();
      const { data } = await supabase.auth.getUser();
      const userId = data?.user?.id;
      if (!userId) {
        notify("You must be signed in.", { type: "error" });
        return;
      }
      window.location.href = buildAuthUrl(userId, claimId ?? null);
    } catch (err) {
      notify(err instanceof Error ? err.message : String(err), {
        type: "error",
      });
    }
  };

  const saveFolder = async () => {
    if (!claimId) return;
    const cleaned = folderInput.trim();
    if (!cleaned) {
      notify("Folder path can't be empty.", { type: "warning" });
      return;
    }
    const supabase = getSupabaseClient();
    const { data: user } = await supabase.auth.getUser();
    const authUserId = user?.user?.id;
    let configuredBy: number | null = null;
    if (authUserId) {
      const { data: sales } = await supabase
        .from("sales")
        .select("id")
        .eq("user_id", authUserId)
        .maybeSingle();
      configuredBy = sales?.id ?? null;
    }
    const normalized = cleaned.startsWith("/") ? cleaned : `/${cleaned}`;
    const { error } = await supabase.from("claim_dropbox_folders").upsert(
      {
        claim_id: claimId,
        folder_path: normalized,
        configured_by_sales_id: configuredBy,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "claim_id" },
    );
    if (error) {
      notify(`Could not save folder: ${error.message}`, { type: "error" });
      return;
    }
    setFolderPath(normalized);
    setShowFolderDialog(false);
    notify("Folder linked. Loading files…", { type: "success" });
  };

  if (!claim) return null;

  return (
    <Card className="border-amber-500/30 bg-amber-500/5">
      <CardHeader className="pb-3 flex flex-row items-center justify-between">
        <CardTitle className="text-sm font-semibold flex items-center gap-2">
          <Box className="h-4 w-4" />
          Dropbox
          {folderPath && (
            <Badge variant="outline" className="text-[10px] font-mono">
              {folderPath}
            </Badge>
          )}
          {connection?.dropbox_email && (
            <span className="text-[10px] text-muted-foreground font-normal">
              ({connection.dropbox_email})
            </span>
          )}
        </CardTitle>
        <div className="flex gap-2">
          {connection && (
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => {
                setFolderInput(folderPath ?? "");
                setShowFolderDialog(true);
              }}
            >
              <Settings className="h-3 w-3" />
              {folderPath ? "Change folder" : "Set folder"}
            </Button>
          )}
          {connection && folderPath && (
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => void loadFiles()}
              disabled={loadingFiles}
            >
              {loadingFiles ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <RefreshCw className="h-3 w-3" />
              )}
              Refresh
            </Button>
          )}
        </div>
      </CardHeader>

      <CardContent className="space-y-3">
        {loadingConnection && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="h-3 w-3 animate-spin" />
            Loading…
          </div>
        )}

        {!loadingConnection && !connection && (
          <>
            <p className="text-xs text-muted-foreground">
              Connect your Dropbox to view this claim's documents alongside the
              CRM. Read-only access (`files.metadata.read` +
              `files.content.read`). One connection per staffer.
            </p>
            <Button type="button" size="sm" onClick={() => void startOauth()}>
              <Box className="h-4 w-4" /> Connect Dropbox
            </Button>
          </>
        )}

        {!loadingConnection && connection && !folderPath && (
          <Alert>
            <FolderOpen className="h-4 w-4" />
            <AlertDescription className="text-xs">
              No Dropbox folder is linked to this claim yet. Click{" "}
              <strong>Set folder</strong> and enter the path (e.g.{" "}
              <code>/Claims/Smith/2026</code>).
            </AlertDescription>
          </Alert>
        )}

        {connection && folderPath && (
          <>
            {loadingFiles && entries.length === 0 && (
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Loader2 className="h-3 w-3 animate-spin" />
                Listing folder…
              </div>
            )}

            {!loadingFiles && entries.length === 0 && (
              <p className="text-xs text-muted-foreground">
                Folder is empty (or the path is wrong). Verify in Dropbox.
              </p>
            )}

            {entries.length > 0 && (
              <div className="space-y-1">
                {entries.map((e) => (
                  <FileRow key={e.id} entry={e} />
                ))}
              </div>
            )}
          </>
        )}
      </CardContent>

      {showFolderDialog && (
        <Dialog open={showFolderDialog} onOpenChange={setShowFolderDialog}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <FolderOpen className="h-4 w-4" />
                Link Dropbox folder
              </DialogTitle>
              <DialogDescription className="text-xs">
                Paste the absolute folder path from your Dropbox (e.g.{" "}
                <code>/Claims/Smith/2026</code>). We list files inside that
                folder live — nothing is copied or synced.
              </DialogDescription>
            </DialogHeader>
            <Input
              value={folderInput}
              onChange={(e) => setFolderInput(e.target.value)}
              placeholder="/Claims/Smith/2026"
              className="text-xs"
            />
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setShowFolderDialog(false)}
              >
                Cancel
              </Button>
              <Button type="button" onClick={() => void saveFolder()}>
                Save
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </Card>
  );
}

function FileRow({ entry }: { entry: FileEntry }) {
  const isFolder = entry.kind === "folder";
  const sizeKb = entry.size ? Math.round(entry.size / 1024) : null;
  return (
    <div className="text-xs border-l-2 border-emerald-500/60 pl-2 flex items-center gap-2 flex-wrap">
      {isFolder ? (
        <Folder className="h-3 w-3 text-muted-foreground" />
      ) : (
        <Badge variant="outline" className="text-[10px]">
          {entry.file_kind
            ? (FILE_KIND_LABEL[entry.file_kind] ?? entry.file_kind)
            : "File"}
        </Badge>
      )}
      <a
        href={entry.preview_url}
        target="_blank"
        rel="noopener noreferrer"
        className="hover:underline font-medium truncate max-w-[320px]"
      >
        {entry.name}
      </a>
      <a
        href={entry.preview_url}
        target="_blank"
        rel="noopener noreferrer"
        className="text-muted-foreground"
        title="Open in Dropbox"
      >
        <ExternalLink className="h-3 w-3" />
      </a>
      {sizeKb !== null && (
        <span className="text-[10px] text-muted-foreground">{sizeKb} KB</span>
      )}
      {entry.modified_at && (
        <span className="text-[10px] text-muted-foreground">
          {new Date(entry.modified_at).toLocaleDateString()}
        </span>
      )}
    </div>
  );
}

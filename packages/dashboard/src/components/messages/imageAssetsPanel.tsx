import {
  ContentCopy,
  DeleteOutline,
  ImageOutlined,
  Upload,
} from "@mui/icons-material";
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  Stack,
  Typography,
} from "@mui/material";
import axios from "axios";
import {
  AmieAsset,
  AmieAssetListResponse,
} from "isomorphic-lib/src/amieAssets";
import { CompletionStatus } from "isomorphic-lib/src/types";
import React, { useCallback, useEffect, useRef, useState } from "react";

import { useAppStorePick } from "../../lib/appStore";
import { useAuthHeaders, useBaseApiUrl } from "../../lib/authModeProvider";

export default function ImageAssetsPanel({
  disabled,
  label = "Images",
  onInsert,
  onUploaded,
}: {
  disabled?: boolean;
  label?: string;
  onInsert: (asset: AmieAsset) => void;
  onUploaded?: (asset: AmieAsset) => void;
}) {
  const baseApiUrl = useBaseApiUrl();
  const authHeaders = useAuthHeaders();
  const { workspace } = useAppStorePick(["workspace"]);
  const workspaceId =
    workspace.type === CompletionStatus.Successful ? workspace.value.id : null;
  const inputRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [assets, setAssets] = useState<AmieAsset[]>([]);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadAssets = useCallback(async () => {
    if (!workspaceId) return;
    setLoading(true);
    setError(null);
    try {
      const response = await axios.get<AmieAssetListResponse>(
        `${baseApiUrl}/content/assets`,
        { params: { workspaceId }, headers: authHeaders },
      );
      setAssets(response.data.assets);
    } catch {
      setError("Images couldn’t be loaded. Please try again.");
    } finally {
      setLoading(false);
    }
  }, [authHeaders, baseApiUrl, workspaceId]);

  useEffect(() => {
    if (open) void loadAssets();
  }, [loadAssets, open]);

  const uploadFiles = async (files: FileList | File[]) => {
    if (!workspaceId || uploading) return;
    setUploading(true);
    setError(null);
    try {
      const uploaded = await Promise.all(
        Array.from(files).map(async (file) => {
          const form = new FormData();
          form.append("workspaceId", workspaceId);
          form.append("file", file);
          const response = await axios.post<AmieAsset>(
            `${baseApiUrl}/content/assets`,
            form,
            { headers: authHeaders },
          );
          return response.data;
        }),
      );
      setAssets((current) => [
        ...uploaded,
        ...current.filter(
          (asset) => !uploaded.some((item) => item.id === asset.id),
        ),
      ]);
      uploaded.forEach((asset) => onUploaded?.(asset));
    } catch {
      setError(
        "The image couldn’t be uploaded. Use PNG, JPG, GIF, or WebP up to 5 MB.",
      );
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  const deleteAsset = async (asset: AmieAsset) => {
    if (!workspaceId) return;
    try {
      await axios.delete(
        `${baseApiUrl}/content/assets/${encodeURIComponent(asset.id)}`,
        { params: { workspaceId }, headers: authHeaders },
      );
      setAssets((current) => current.filter((item) => item.id !== asset.id));
    } catch {
      setError("The image couldn’t be deleted.");
    }
  };

  return (
    <>
      <Button
        size="small"
        startIcon={<ImageOutlined />}
        disabled={Boolean(disabled) || !workspaceId}
        onClick={() => setOpen(true)}
      >
        {label}
      </Button>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        fullWidth
        maxWidth="md"
      >
        <DialogTitle>Images</DialogTitle>
        <DialogContent>
          <Stack spacing={2}>
            <Box
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => {
                event.preventDefault();
                void uploadFiles(event.dataTransfer.files);
              }}
              sx={{
                border: "1px dashed",
                borderColor: "divider",
                borderRadius: 2,
                p: 3,
                textAlign: "center",
                backgroundColor: "background.default",
              }}
            >
              <input
                ref={inputRef}
                hidden
                multiple
                type="file"
                accept="image/png,image/jpeg,image/gif,image/webp"
                onChange={(event) => {
                  if (event.target.files) void uploadFiles(event.target.files);
                }}
              />
              <Button
                variant="outlined"
                startIcon={
                  uploading ? <CircularProgress size={16} /> : <Upload />
                }
                disabled={uploading}
                onClick={() => inputRef.current?.click()}
              >
                {uploading ? "Uploading…" : "Upload images"}
              </Button>
              <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
                Or drop PNG, JPG, GIF, or WebP files here. Maximum 5 MB each.
              </Typography>
            </Box>

            {error && <Alert severity="error">{error}</Alert>}
            {loading ? (
              <Box sx={{ display: "grid", placeItems: "center", py: 5 }}>
                <CircularProgress size={24} />
              </Box>
            ) : (
              <Box
                sx={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))",
                  gap: 2,
                }}
              >
                {assets.map((asset) => (
                  <Box
                    key={asset.id}
                    sx={{
                      border: "1px solid",
                      borderColor: "divider",
                      borderRadius: 2,
                      overflow: "hidden",
                    }}
                  >
                    <Box
                      component="img"
                      src={asset.url}
                      alt=""
                      sx={{
                        display: "block",
                        width: "100%",
                        height: 120,
                        objectFit: "contain",
                        bgcolor: "grey.50",
                      }}
                    />
                    <Stack spacing={1} sx={{ p: 1.25 }}>
                      <Typography variant="caption" noWrap title={asset.name}>
                        {asset.name}
                      </Typography>
                      <Stack direction="row" spacing={0.5} alignItems="center">
                        <Button
                          size="small"
                          variant="contained"
                          onClick={() => {
                            onInsert(asset);
                            setOpen(false);
                          }}
                        >
                          Insert
                        </Button>
                        <IconButton
                          size="small"
                          aria-label="Copy image URL"
                          onClick={() =>
                            void navigator.clipboard.writeText(asset.url)
                          }
                        >
                          <ContentCopy fontSize="small" />
                        </IconButton>
                        <IconButton
                          size="small"
                          aria-label="Delete image"
                          onClick={() => void deleteAsset(asset)}
                        >
                          <DeleteOutline fontSize="small" />
                        </IconButton>
                      </Stack>
                    </Stack>
                  </Box>
                ))}
              </Box>
            )}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setOpen(false)}>Close</Button>
        </DialogActions>
      </Dialog>
    </>
  );
}

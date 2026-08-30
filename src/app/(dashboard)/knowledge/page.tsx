"use client";

import * as React from "react";
import {
  UploadCloud,
  FileText,
  FileSpreadsheet,
  Presentation,
  Image as ImageIcon,
  Video,
  Music,
  Link2,
  Loader2,
  CheckCircle2,
  XCircle,
  Trash2,
  Search,
} from "lucide-react";
import { PageHeader } from "@/components/shared/page-header";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import Link from "next/link";

interface KnowledgeDoc {
  id: string;
  title: string;
  sourceType: string;
  category: string;
  status: string;
  errorMessage: string | null;
  chunkCount: number;
  createdAt: string;
}

const sourceIcons: Record<string, React.ElementType> = {
  pdf: FileText,
  word: FileText,
  excel: FileSpreadsheet,
  powerpoint: Presentation,
  image: ImageIcon,
  video: Video,
  audio: Music,
  url: Link2,
};

const statusLabel: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline" | "signal" }> = {
  PENDING: { label: "Queued", variant: "outline" },
  EXTRACTING: { label: "Extracting text", variant: "secondary" },
  TRANSCRIBING: { label: "Transcribing", variant: "secondary" },
  CHUNKING: { label: "Processing", variant: "secondary" },
  EMBEDDING: { label: "Indexing", variant: "secondary" },
  READY: { label: "Ready", variant: "signal" },
  FAILED: { label: "Failed", variant: "destructive" },
};

const categories = [
  { value: "general", label: "General" },
  { value: "policy", label: "Policy" },
  { value: "contract", label: "Contract" },
  { value: "invoice", label: "Invoice" },
  { value: "manual", label: "Manual" },
  { value: "training", label: "Training" },
];

export default function KnowledgeBasePage() {
  const { toast } = useToast();
  const [docs, setDocs] = React.useState<KnowledgeDoc[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [dragActive, setDragActive] = React.useState(false);
  const [uploading, setUploading] = React.useState(false);
  const [category, setCategory] = React.useState("general");
  const [urlInput, setUrlInput] = React.useState("");
  const [addingUrl, setAddingUrl] = React.useState(false);
  const fileInputRef = React.useRef<HTMLInputElement>(null);

  const loadDocs = React.useCallback(async () => {
    setLoading(true);
    const res = await fetch("/api/knowledge/documents");
    if (res.ok) {
      const body = await res.json();
      setDocs(body.documents ?? []);
    }
    setLoading(false);
  }, []);

  React.useEffect(() => {
    loadDocs();
    // Poll while anything is still processing, so status updates live
    // without the user needing to refresh manually.
    const interval = setInterval(() => {
      setDocs((current) => {
        const stillProcessing = current.some((d) => !["READY", "FAILED"].includes(d.status));
        if (stillProcessing) loadDocs();
        return current;
      });
    }, 4000);
    return () => clearInterval(interval);
  }, [loadDocs]);

  async function uploadFiles(files: FileList | File[]) {
    setUploading(true);
    for (const file of Array.from(files)) {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("category", category);

      const res = await fetch("/api/knowledge/upload", { method: "POST", body: formData });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        toast({ variant: "destructive", title: `Couldn't process ${file.name}`, description: body?.error });
      }
    }
    setUploading(false);
    loadDocs();
  }

  async function handleAddUrl() {
    if (!urlInput) return;
    setAddingUrl(true);
    const res = await fetch("/api/knowledge/upload-url", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: urlInput, category }),
    });
    const body = await res.json().catch(() => null);
    setAddingUrl(false);

    if (!res.ok) {
      toast({ variant: "destructive", title: "Couldn't add URL", description: body?.error });
      return;
    }

    setUrlInput("");
    toast({ variant: "success", title: "Website added" });
    loadDocs();
  }

  async function handleDelete(id: string) {
    const res = await fetch(`/api/knowledge/documents/${id}`, { method: "DELETE" });
    if (!res.ok) {
      toast({ variant: "destructive", title: "Couldn't delete document" });
      return;
    }
    toast({ title: "Document removed" });
    loadDocs();
  }

  return (
    <div className="max-w-4xl space-y-8">
      <div className="flex items-center justify-between">
        <PageHeader
          title="Knowledge base"
          description="Upload company documents so AI agents can search and reference them."
        />
        <Button variant="outline" asChild>
          <Link href="/knowledge/search">
            <Search className="h-4 w-4" /> Search
          </Link>
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Add documents</CardTitle>
          <CardDescription>
            Supports PDF, Word, Excel, PowerPoint, images, video, audio, and website URLs.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center gap-3">
            <span className="text-sm font-medium">Category</span>
            <Select value={category} onValueChange={setCategory}>
              <SelectTrigger className="w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {categories.map((c) => (
                  <SelectItem key={c.value} value={c.value}>
                    {c.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div
            onDragOver={(e) => {
              e.preventDefault();
              setDragActive(true);
            }}
            onDragLeave={() => setDragActive(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragActive(false);
              if (e.dataTransfer.files.length > 0) uploadFiles(e.dataTransfer.files);
            }}
            onClick={() => fileInputRef.current?.click()}
            className={`flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed p-10 text-center transition-colors ${
              dragActive ? "border-signal bg-signal/5" : "border-border hover:bg-accent/50"
            }`}
          >
            <input
              ref={fileInputRef}
              type="file"
              multiple
              className="hidden"
              onChange={(e) => e.target.files && uploadFiles(e.target.files)}
            />
            {uploading ? (
              <Loader2 className="h-8 w-8 animate-spin text-signal" />
            ) : (
              <UploadCloud className="h-8 w-8 text-muted-foreground" />
            )}
            <p className="mt-3 text-sm font-medium">
              {uploading ? "Uploading…" : "Drag files here, or tap to browse"}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              PDF, Word, Excel, PowerPoint, images, video, audio
            </p>
          </div>

          <div className="flex items-center gap-2">
            <Input
              placeholder="https://example.com/handbook"
              value={urlInput}
              onChange={(e) => setUrlInput(e.target.value)}
            />
            <Button variant="outline" onClick={handleAddUrl} disabled={!urlInput || addingUrl}>
              {addingUrl ? <Loader2 className="h-4 w-4 animate-spin" /> : <Link2 className="h-4 w-4" />}
              Add URL
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Documents</CardTitle>
          <CardDescription>{docs.length} item{docs.length !== 1 ? "s" : ""} in your knowledge base.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {loading ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : docs.length === 0 ? (
            <p className="text-sm text-muted-foreground">No documents uploaded yet.</p>
          ) : (
            docs.map((doc) => {
              const Icon = sourceIcons[doc.sourceType] ?? FileText;
              const status = statusLabel[doc.status] ?? statusLabel.PENDING;
              return (
                <div key={doc.id} className="flex items-center justify-between rounded-md border border-border p-3">
                  <div className="flex min-w-0 items-center gap-3">
                    <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{doc.title}</p>
                      <p className="text-xs text-muted-foreground">
                        {doc.category} · {doc.chunkCount} chunk{doc.chunkCount !== 1 ? "s" : ""}
                        {doc.errorMessage && ` · ${doc.errorMessage}`}
                      </p>
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    {status.variant === "secondary" && <Loader2 className="h-3 w-3 animate-spin" />}
                    {doc.status === "READY" && <CheckCircle2 className="h-3.5 w-3.5 text-signal" />}
                    {doc.status === "FAILED" && <XCircle className="h-3.5 w-3.5 text-destructive" />}
                    <Badge variant={status.variant}>{status.label}</Badge>
                    <Button size="icon" variant="ghost" onClick={() => handleDelete(doc.id)}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              );
            })
          )}
        </CardContent>
      </Card>
    </div>
  );
}

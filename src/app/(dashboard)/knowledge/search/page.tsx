"use client";

import * as React from "react";
import Link from "next/link";
import { Search, Loader2, ArrowLeft, FileText, FileSpreadsheet, Presentation, Image as ImageIcon, Video, Music, Link2 } from "lucide-react";
import { PageHeader } from "@/components/shared/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";

interface SearchResult {
  chunkId: string;
  documentId: string;
  content: string;
  similarity: number;
  documentTitle: string;
  sourceType: string;
  category: string;
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

export default function KnowledgeSearchPage() {
  const [query, setQuery] = React.useState("");
  const [results, setResults] = React.useState<SearchResult[] | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [searched, setSearched] = React.useState(false);

  async function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    if (!query.trim()) return;

    setLoading(true);
    setSearched(true);
    const res = await fetch("/api/knowledge/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query, matchCount: 10 }),
    });
    const body = await res.json().catch(() => null);
    setLoading(false);

    if (res.ok) {
      setResults(body.results ?? []);
    } else {
      setResults([]);
    }
  }

  return (
    <div className="max-w-3xl space-y-8">
      <div>
        <Link href="/knowledge" className="mb-2 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-3.5 w-3.5" /> Back to knowledge base
        </Link>
        <PageHeader
          title="Search knowledge base"
          description="Ask a question in plain language — this searches by meaning, not just keywords."
        />
      </div>

      <form onSubmit={handleSearch} className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="e.g. What's our policy on remote work?"
            className="pl-9"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <Button type="submit" variant="signal" disabled={!query.trim() || loading}>
          {loading && <Loader2 className="h-4 w-4 animate-spin" />}
          Search
        </Button>
      </form>

      {searched && !loading && results?.length === 0 && (
        <p className="text-sm text-muted-foreground">
          No relevant results found. Try rephrasing, or make sure documents have finished processing.
        </p>
      )}

      <div className="space-y-3">
        {results?.map((r) => {
          const Icon = sourceIcons[r.sourceType] ?? FileText;
          return (
            <Card key={r.chunkId}>
              <CardContent className="space-y-2 p-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 text-sm font-medium">
                    <Icon className="h-4 w-4 text-muted-foreground" />
                    {r.documentTitle}
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant="outline">{r.category}</Badge>
                    <span className="text-xs text-muted-foreground">
                      {Math.round(r.similarity * 100)}% match
                    </span>
                  </div>
                </div>
                <p className="text-sm text-muted-foreground">{r.content}</p>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}

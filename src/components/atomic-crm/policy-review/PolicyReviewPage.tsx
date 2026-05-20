import { useState } from "react";
import { AlertCircleIcon, FileSearchIcon, ShieldAlertIcon } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { analyzePolicy, type PolicyAnalysis } from "@/api/policy";
import { extractPdfText } from "./extractPdfText";

type Status = "idle" | "loading" | "error" | "done";
type PdfStatus = "idle" | "extracting" | "ready" | "error";

// Keep in sync with MIN_POLICY_CHARS in the analyze_policy edge function.
const MIN_POLICY_CHARS = 50;

export const PolicyReviewPage = () => {
  const [policyText, setPolicyText] = useState("");
  const [carrier, setCarrier] = useState("");
  const [state, setState] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState("");
  const [analysis, setAnalysis] = useState<PolicyAnalysis | null>(null);
  const [pdfStatus, setPdfStatus] = useState<PdfStatus>("idle");
  const [pdfNote, setPdfNote] = useState("");

  const charCount = policyText.trim().length;
  const canAnalyze =
    charCount >= MIN_POLICY_CHARS &&
    status !== "loading" &&
    pdfStatus !== "extracting";

  const handlePdfFile = async (file: File | undefined) => {
    if (!file) return;
    setPdfStatus("extracting");
    setPdfNote("");
    setError("");
    try {
      const { text, pageCount, likelyScanned } = await extractPdfText(file);
      setPolicyText(text);
      if (likelyScanned) {
        setPdfStatus("error");
        setPdfNote(
          `Extracted ${pageCount} page(s) but found almost no text. ` +
            "This is likely a scanned PDF — OCR is not supported yet, so " +
            "paste the policy text manually.",
        );
      } else {
        setPdfStatus("ready");
        setPdfNote(`Extracted text from ${file.name} (${pageCount} page(s)).`);
      }
    } catch (err) {
      setPdfStatus("error");
      setPdfNote(
        `Could not read PDF: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  };

  const handleAnalyze = async () => {
    setStatus("loading");
    setError("");
    setAnalysis(null);
    try {
      const result = await analyzePolicy({
        policyText,
        carrier: carrier.trim() || undefined,
        state: state.trim() || undefined,
      });
      setAnalysis(result);
      setStatus("done");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setStatus("error");
    }
  };

  return (
    <div className="max-w-4xl mx-auto mt-8 mb-16 px-4 flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold flex items-center gap-2">
          <FileSearchIcon className="h-6 w-6" /> Policy Review
        </h1>
        <p className="text-muted-foreground text-sm mt-1">
          Paste an insurance policy to get a structured breakdown of coverages,
          deductibles, exclusions, endorsements, and claim-resolution
          considerations.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Policy text</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="policy-pdf">Upload a policy PDF</Label>
            <Input
              id="policy-pdf"
              type="file"
              accept="application/pdf,.pdf"
              disabled={pdfStatus === "extracting"}
              onChange={(e) => handlePdfFile(e.target.files?.[0])}
            />
            {pdfStatus === "extracting" && (
              <span className="text-xs text-muted-foreground">
                Extracting text from PDF...
              </span>
            )}
            {pdfNote && (
              <span
                className={
                  pdfStatus === "error"
                    ? "text-xs text-destructive"
                    : "text-xs text-muted-foreground"
                }
              >
                {pdfNote}
              </span>
            )}
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="policy-text">
              Or paste the full policy or declarations page
            </Label>
            <Textarea
              id="policy-text"
              value={policyText}
              onChange={(e) => setPolicyText(e.target.value)}
              rows={12}
              placeholder="Paste policy text here..."
            />
            <span className="text-xs text-muted-foreground">
              {charCount.toLocaleString()} characters
            </span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="carrier">Carrier (optional)</Label>
              <Input
                id="carrier"
                value={carrier}
                onChange={(e) => setCarrier(e.target.value)}
                placeholder="e.g. State Farm"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="state">Claim state (optional)</Label>
              <Input
                id="state"
                value={state}
                onChange={(e) => setState(e.target.value)}
                placeholder="e.g. FL or Florida"
              />
            </div>
          </div>
          <div>
            <Button onClick={handleAnalyze} disabled={!canAnalyze}>
              {status === "loading" ? "Analyzing..." : "Analyze policy"}
            </Button>
          </div>
        </CardContent>
      </Card>

      {status === "error" && (
        <Alert variant="destructive">
          <AlertCircleIcon />
          <AlertTitle>Analysis failed</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {analysis && <AnalysisResult analysis={analysis} />}
    </div>
  );
};

PolicyReviewPage.path = "/policy-review";

const AnalysisResult = ({ analysis }: { analysis: PolicyAnalysis }) => (
  <div className="flex flex-col gap-6">
    <Alert>
      <ShieldAlertIcon />
      <AlertTitle>For licensed adjuster review</AlertTitle>
      <AlertDescription>{analysis.disclaimer}</AlertDescription>
    </Alert>

    <Card>
      <CardHeader>
        <CardTitle>Summary</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <p className="text-sm">
          {analysis.summary || "No summary was returned for this policy."}
        </p>
        <div className="flex flex-wrap gap-2">
          <FactBadge label="Carrier" value={analysis.carrier} />
          <FactBadge label="Policy #" value={analysis.policyNumber} />
          <FactBadge label="Form" value={analysis.policyForm} />
          <FactBadge label="State" value={analysis.state} />
          <FactBadge label="Named insured" value={analysis.namedInsured} />
          <FactBadge label="Effective" value={analysis.effectiveDate} />
          <FactBadge label="Expires" value={analysis.expirationDate} />
        </div>
      </CardContent>
    </Card>

    {analysis.coverages.length > 0 && (
      <SectionCard title="Coverages">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Coverage</TableHead>
              <TableHead>Limit</TableHead>
              <TableHead>Notes</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {analysis.coverages.map((c, i) => (
              <TableRow key={i}>
                <TableCell className="font-medium">{c.name}</TableCell>
                <TableCell>{c.limit ?? "—"}</TableCell>
                <TableCell className="text-muted-foreground">
                  {c.description ?? "—"}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </SectionCard>
    )}

    {analysis.deductibles.length > 0 && (
      <SectionCard title="Deductibles">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Deductible</TableHead>
              <TableHead>Amount</TableHead>
              <TableHead>Basis</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {analysis.deductibles.map((d, i) => (
              <TableRow key={i}>
                <TableCell className="font-medium">{d.name}</TableCell>
                <TableCell>{d.amount ?? "—"}</TableCell>
                <TableCell>
                  <Badge variant="secondary">{d.basis}</Badge>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </SectionCard>
    )}

    {analysis.sublimits.length > 0 && (
      <SectionCard title="Sublimits">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Item</TableHead>
              <TableHead>Limit</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {analysis.sublimits.map((s, i) => (
              <TableRow key={i}>
                <TableCell className="font-medium">{s.name}</TableCell>
                <TableCell>{s.limit ?? "—"}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </SectionCard>
    )}

    {analysis.exclusions.length > 0 && (
      <SectionCard title="Exclusions">
        <ul className="flex flex-col gap-2">
          {analysis.exclusions.map((e, i) => (
            <li key={i} className="text-sm">
              <span className="font-medium">{e.name}</span>
              {e.description ? (
                <span className="text-muted-foreground">
                  {" "}
                  — {e.description}
                </span>
              ) : null}
            </li>
          ))}
        </ul>
      </SectionCard>
    )}

    {analysis.endorsements.length > 0 && (
      <SectionCard title="Endorsements">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Endorsement</TableHead>
              <TableHead>Form #</TableHead>
              <TableHead>Effect</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {analysis.endorsements.map((e, i) => (
              <TableRow key={i}>
                <TableCell className="font-medium">{e.name}</TableCell>
                <TableCell>{e.formNumber ?? "—"}</TableCell>
                <TableCell className="text-muted-foreground">
                  {e.effect ?? "—"}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </SectionCard>
    )}

    {analysis.notableConditions.length > 0 && (
      <ListCard title="Notable conditions" items={analysis.notableConditions} />
    )}
    {analysis.bestPracticeNotes.length > 0 && (
      <ListCard
        title="Best-practice considerations"
        items={analysis.bestPracticeNotes}
      />
    )}
    {analysis.complianceFlags.length > 0 && (
      <ListCard
        title="Compliance items to verify"
        items={analysis.complianceFlags}
        accent
      />
    )}
  </div>
);

const FactBadge = ({
  label,
  value,
}: {
  label: string;
  value: string | null;
}) =>
  value ? (
    <Badge variant="outline" className="font-normal">
      <span className="text-muted-foreground">{label}:</span>
      <span className="ml-1">{value}</span>
    </Badge>
  ) : null;

const SectionCard = ({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) => (
  <Card>
    <CardHeader>
      <CardTitle>{title}</CardTitle>
    </CardHeader>
    <CardContent>{children}</CardContent>
  </Card>
);

const ListCard = ({
  title,
  items,
  accent,
}: {
  title: string;
  items: string[];
  accent?: boolean;
}) => (
  <SectionCard title={title}>
    <ul className="flex flex-col gap-2 list-disc pl-5">
      {items.map((item, i) => (
        <li key={i} className={accent ? "text-sm text-destructive" : "text-sm"}>
          {item}
        </li>
      ))}
    </ul>
  </SectionCard>
);

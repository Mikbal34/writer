"use client";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export interface BookBasicsData {
  title: string;
  topic: string;
  purpose: string;
  audience: string;
  language: string;
}

interface BookBasicsFormProps {
  data: BookBasicsData;
  onChange: (data: BookBasicsData) => void;
}

const LANGUAGES = [
  { value: "tr", label: "Turkish" },
  { value: "en", label: "English" },
  { value: "ar", label: "Arabic" },
  { value: "de", label: "German" },
  { value: "fr", label: "French" },
];

export default function BookBasicsForm({ data, onChange }: BookBasicsFormProps) {
  function update(field: keyof BookBasicsData, value: string) {
    onChange({ ...data, [field]: value });
  }

  return (
    <div className="space-y-5">
      <div className="space-y-2">
        <Label htmlFor="title">Book Title *</Label>
        <Input
          id="title"
          placeholder="e.g. Introduction to Islamic Philosophy"
          value={data.title}
          onChange={(e) => update("title", e.target.value)}
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="topic">Topic / Subject *</Label>
        <Input
          id="topic"
          placeholder="e.g. Classical Islamic philosophy and its modern implications"
          value={data.topic}
          onChange={(e) => update("topic", e.target.value)}
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="purpose">Purpose *</Label>
        <Textarea
          id="purpose"
          placeholder="What is the goal of this book? e.g. An academic textbook for undergraduate students..."
          value={data.purpose}
          onChange={(e) => update("purpose", e.target.value)}
          rows={3}
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="audience">Target Audience *</Label>
        <Input
          id="audience"
          placeholder="e.g. Undergraduate theology students"
          value={data.audience}
          onChange={(e) => update("audience", e.target.value)}
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="language">Writing Language</Label>
        <Select
          value={data.language}
          onValueChange={(val) => val && update("language", val)}
        >
          <SelectTrigger id="language">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {LANGUAGES.map((lang) => (
              <SelectItem key={lang.value} value={lang.value}>
                {lang.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}

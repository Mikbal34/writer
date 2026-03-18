"use client";

import { useState } from "react";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
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
  const [errors, setErrors] = useState<Partial<Record<keyof BookBasicsData, string>>>({});

  function validate(field: keyof BookBasicsData, value: string) {
    const newErrors = { ...errors };
    if (!value.trim()) {
      newErrors[field] = "This field is required";
    } else {
      delete newErrors[field];
    }
    setErrors(newErrors);
  }

  function handleChange(field: keyof BookBasicsData, value: string) {
    validate(field, value);
    onChange({ ...data, [field]: value });
  }

  return (
    <div className="space-y-5">
      <div className="space-y-2">
        <Label htmlFor="title">
          Book Title <span className="text-destructive">*</span>
        </Label>
        <Input
          id="title"
          placeholder="e.g. The History of Ottoman Jurisprudence"
          value={data.title}
          onChange={(e) => handleChange("title", e.target.value)}
          className={errors.title ? "border-destructive" : ""}
        />
        {errors.title && (
          <p className="text-xs text-destructive">{errors.title}</p>
        )}
      </div>

      <div className="space-y-2">
        <Label htmlFor="topic">
          Main Topic / Subject <span className="text-destructive">*</span>
        </Label>
        <Textarea
          id="topic"
          placeholder="Describe the core subject matter of your book..."
          value={data.topic}
          onChange={(e) => handleChange("topic", e.target.value)}
          className={`min-h-[80px] resize-none ${errors.topic ? "border-destructive" : ""}`}
        />
        {errors.topic && (
          <p className="text-xs text-destructive">{errors.topic}</p>
        )}
      </div>

      <div className="space-y-2">
        <Label htmlFor="purpose">
          Purpose & Goals <span className="text-destructive">*</span>
        </Label>
        <Textarea
          id="purpose"
          placeholder="What do you want readers to gain from this book? What gap does it fill?"
          value={data.purpose}
          onChange={(e) => handleChange("purpose", e.target.value)}
          className={`min-h-[80px] resize-none ${errors.purpose ? "border-destructive" : ""}`}
        />
        {errors.purpose && (
          <p className="text-xs text-destructive">{errors.purpose}</p>
        )}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
        <div className="space-y-2">
          <Label htmlFor="audience">
            Target Audience <span className="text-destructive">*</span>
          </Label>
          <Input
            id="audience"
            placeholder="e.g. Graduate students, academics, general readers"
            value={data.audience}
            onChange={(e) => handleChange("audience", e.target.value)}
            className={errors.audience ? "border-destructive" : ""}
          />
          {errors.audience && (
            <p className="text-xs text-destructive">{errors.audience}</p>
          )}
        </div>

        <div className="space-y-2">
          <Label htmlFor="language">Language</Label>
          <Select
            value={data.language}
            onValueChange={(val) => { if (val) handleChange("language", val); }}
          >
            <SelectTrigger id="language">
              <SelectValue placeholder="Select language" />
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
    </div>
  );
}

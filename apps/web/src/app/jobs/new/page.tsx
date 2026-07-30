'use client';

import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useState } from 'react';
import { JOB_CATEGORIES, type JobDto } from '@trustlance/shared-types';
import { ApiClientError, apiRequest } from '@/lib/api';
import { Banner, Button, Field, FormError, SelectField, TextareaField } from '@/components/ui';
import { RequireRole } from '@/components/require-role';

export default function NewJobPage() {
  return (
    <RequireRole role="CLIENT">
      <NewJobForm />
    </RequireRole>
  );
}

function NewJobForm() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    setFormError(null);
    setFieldErrors({});
    const form = new FormData(e.currentTarget);

    try {
      const job = await apiRequest<JobDto>('/api/jobs', {
        method: 'POST',
        body: {
          title: String(form.get('title')),
          description: String(form.get('description')),
          category: String(form.get('category')),
          // Dollars in, integer cents out (§11).
          budgetCents: Math.round(Number(form.get('budget')) * 100),
          skills: String(form.get('skills'))
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean),
        },
      });
      router.push(`/jobs/${job.id}`);
    } catch (err) {
      if (err instanceof ApiClientError && err.details) {
        setFieldErrors(Object.fromEntries(Object.entries(err.details).map(([k, v]) => [k, v[0] ?? ''])));
      } else {
        setFormError(err instanceof ApiClientError ? err.message : 'Could not reach the server.');
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="container-mid py-10">
      <Link href="/jobs" className="text-muted hover:text-foreground">
        ← Back to jobs
      </Link>

      <h1 className="mt-6 text-3xl font-semibold tracking-tight sm:text-4xl">Post a job</h1>
      <p className="mt-3 text-lg text-muted">
        Describe the work. You’ll split it into funded milestones when you accept a proposal.
      </p>

      <div className="mt-8">
        <Banner tone="accent" title="How payment works">
          You fund each milestone separately, and money only moves when you approve the work — or
          after a review window lapses. Nothing is charged now.
        </Banner>
      </div>

      <form onSubmit={onSubmit} className="mt-10 flex flex-col gap-7">
        <Field
          label="Job title"
          name="title"
          required
          placeholder="e.g. Build a milestone escrow dashboard"
          error={fieldErrors.title}
        />
        <TextareaField
          label="Description"
          name="description"
          rows={8}
          required
          placeholder="What needs building, what done looks like, and any constraints."
          hint="At least 20 characters. Specific scope makes disputes rare."
          error={fieldErrors.description}
        />
        <div className="grid gap-7 sm:grid-cols-2">
          <SelectField label="Category" name="category" required defaultValue="web-development">
            {JOB_CATEGORIES.map((c) => (
              <option key={c} value={c} className="capitalize">
                {c.replace(/-/g, ' ')}
              </option>
            ))}
          </SelectField>
          <Field
            label="Total budget"
            name="budget"
            type="number"
            step="0.01"
            min="1"
            required
            prefix="$"
            error={fieldErrors.budgetCents}
          />
        </div>
        <Field
          label="Skills"
          name="skills"
          hint="Comma separated — helps the right freelancers find this"
          placeholder="React, PostgreSQL, Ed25519"
          error={fieldErrors.skills}
        />

        <FormError message={formError} />
        <div className="flex gap-3">
          <Button type="submit" loading={loading} size="lg">
            Post job
          </Button>
          <Link href="/jobs" className="btn-ghost btn-lg">
            Cancel
          </Link>
        </div>
      </form>
    </div>
  );
}

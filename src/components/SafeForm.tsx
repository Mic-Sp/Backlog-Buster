"use client";

import { createContext, useContext, useRef, useState, type ComponentProps, type Ref } from "react";
import { actionErrorMessage, unwrapActionResult } from "@/lib/action-result";
import { validateGameForm } from "@/lib/form-validation";
import "./SafeForm.css";

type FormAction = (data: FormData) => Promise<unknown>;
const FormContext = createContext<((action: FormAction, deleting?: boolean) => (data: FormData) => Promise<void>) | null>(null);

export default function SafeForm({ action, onSuccess, ref, children, onSubmit, onReset, onInvalidCapture, ...props }: Omit<ComponentProps<"form">, "action"> & { action: FormAction; onSuccess?: () => void; ref?: Ref<HTMLFormElement> }) {
  const [error, setError] = useState("");
  const failed = useRef(false);
  function run(operation: FormAction, deleting = false) {
    return async (data: FormData) => {
      try {
        failed.current = false;
        validateGameForm(data, deleting);
        unwrapActionResult(await operation(data));
        setError("");
        onSuccess?.();
      } catch (cause) { failed.current = true; setError(actionErrorMessage(cause)); }
    };
  }
  return <FormContext.Provider value={run}><form {...props} ref={(node) => {
    if (typeof ref === "function") return ref(node);
    if (ref) ref.current = node;
  }} action={run(action)} onInvalidCapture={(event) => {
    try { validateGameForm(new FormData(event.currentTarget)); }
    catch (cause) { setError(actionErrorMessage(cause)); }
    onInvalidCapture?.(event);
  }} onReset={(event) => {
    if (failed.current) event.preventDefault();
    onReset?.(event);
  }} onSubmit={(event) => {
    setError("");
    const submitter = (event.nativeEvent as SubmitEvent).submitter;
    const deleting = submitter instanceof HTMLButtonElement && submitter.formNoValidate;
    try { validateGameForm(new FormData(event.currentTarget), deleting); }
    catch (cause) { event.preventDefault(); setError(actionErrorMessage(cause)); return; }
    onSubmit?.(event);
  }}>
    {children}
    {error && <p className="form-action-error" role="alert">{error}</p>}
  </form></FormContext.Provider>;
}

export function SafeActionButton({ formAction, ...props }: Omit<ComponentProps<"button">, "formAction"> & { formAction: FormAction }) {
  const run = useContext(FormContext);
  if (!run) throw new Error("SafeActionButton requires SafeForm.");
  return <button {...props} formAction={run(formAction, props.formNoValidate)} />;
}

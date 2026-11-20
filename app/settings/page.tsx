import { redirect } from "next/navigation";

// Settings are a dialog over the app now (components/SettingsDialog); keep old links working.
export default function SettingsPage() {
  redirect("/#settings");
}

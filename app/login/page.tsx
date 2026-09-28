import LoginPanel from "@/components/LoginPanel";
import GoogleSignInForm from "@/components/GoogleSignInForm";

export default function LoginPage() {
  return <LoginPanel signInSlot={<GoogleSignInForm />} />;
}

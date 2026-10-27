export function ErrorLine({ message }: { message: string }) {
  return (
    <p role="alert" className="m-0 text-sm text-text-critical">
      {message}
    </p>
  );
}

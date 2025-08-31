import React from "react";

type Props = { children: React.ReactNode };
type State = { err?: Error, info?: React.ErrorInfo };

export default class ErrorBoundary extends React.Component<Props, State> {
  state: State = {};
  static getDerivedStateFromError(err: Error) { return { err }; }
  componentDidCatch(err: Error, info: React.ErrorInfo) {
    // 控制台 & 屏幕都能看到
    console.error("💥 React ErrorBoundary:", err, info?.componentStack);
  }
  render() {
    const { err } = this.state;
    if (!err) return this.props.children;
    return (
      <div style={{padding:16,fontFamily:"monospace",whiteSpace:"pre-wrap"}}>
        <h2>💥 页面崩了</h2>
        <div style={{color:"#c00", marginTop:8}}>{String(err)}</div>
        <details open style={{marginTop:8}}>
          <summary>stack</summary>
          <pre>{err.stack}</pre>
        </details>
      </div>
    );
  }
}

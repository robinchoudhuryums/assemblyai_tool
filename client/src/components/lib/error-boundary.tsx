import React from 'react';

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends React.Component<any, State> {
  constructor(props: any) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    // You can also log the error to an error reporting service
    console.error("--- ERROR BOUNDARY CAUGHT AN ERROR ---", error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      // You can render any custom fallback UI
      return (
        <div className="p-4 border border-red-500 bg-red-50 rounded-lg text-red-700">
          <p className="font-bold">Something went wrong rendering this item.</p>
          <p className="text-sm">Please check the browser console for details.</p>
        </div>
      );
    }

    return this.props.children; 
  }
}


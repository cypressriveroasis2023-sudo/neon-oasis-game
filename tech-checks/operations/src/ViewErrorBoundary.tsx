import { Component, type ReactNode } from 'react';

type Props = { children: ReactNode; fallback: (retry: () => void) => ReactNode };

export default class ViewErrorBoundary extends Component<Props, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    if (this.state.failed) {
      return this.props.fallback(() => this.setState({ failed: false }));
    }
    return this.props.children;
  }
}

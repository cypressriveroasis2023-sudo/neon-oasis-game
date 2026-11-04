import { Component, type ReactNode } from 'react';

type Props = { children: ReactNode; fallback: (retry: () => void, reference: string) => ReactNode };

export default class ViewErrorBoundary extends Component<Props, { reference: string }> {
  state = { reference: '' };

  static getDerivedStateFromError(error: unknown) {
    const name = error instanceof Error && /^[A-Za-z]{1,24}Error$/.test(error.name)
      ? error.name
      : 'RenderError';
    const code = error instanceof Error ? /Minified React error #(\d+)/.exec(error.message)?.[1] : undefined;
    return { reference: code ? 'React ' + code : name };
  }

  render() {
    if (this.state.reference) {
      return this.props.fallback(() => this.setState({ reference: '' }), this.state.reference);
    }
    return this.props.children;
  }
}

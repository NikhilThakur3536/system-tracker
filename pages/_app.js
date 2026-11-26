import '../styles/globals.css';
import { Provider } from 'react-redux';
import store from '../redux/store';
import AppWrapper from '../components/AppWrapper';
import AppErrorBoundary from '../components/AppIssues/AppErrorBoundary';
import AppIssueToasts from '../components/AppIssues/AppIssueToasts';

function MyApp({ Component, pageProps }) {
  return (
    <Provider store={store}>
      <AppErrorBoundary>
        <AppWrapper>
          <Component {...pageProps} />
        </AppWrapper>
      </AppErrorBoundary>

      {/* Outside the error boundary so alerts still show if the screen fails */}
      <AppIssueToasts />
    </Provider>
  );
}

export default MyApp;

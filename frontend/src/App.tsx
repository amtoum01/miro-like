import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import Login from './components/Auth/Login';
import Register from './components/Auth/Register';
import Whiteboard from './components/Whiteboard/Whiteboard';
import styled from 'styled-components';

const AppContainer = styled.div`
  height: 100vh;
`;

const PrivateRoute: React.FC<{ element: React.ReactElement }> = ({ element }) => {
  const token = localStorage.getItem('token');
  return token ? element : <Navigate to="/login" />;
};

function App() {
  return (
    <AppContainer>
      <Router>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/register" element={<Register />} />
          <Route
            path="/whiteboard"
            element={<PrivateRoute element={<Whiteboard />} />}
          />
          <Route path="/" element={<Navigate to="/login" />} />
        </Routes>
      </Router>
    </AppContainer>
  );
}

export default App;

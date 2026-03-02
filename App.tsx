import React, {useEffect, useRef, useState} from 'react';
import {
  SafeAreaView,
  StyleSheet,
  View,
  Text,
  TouchableOpacity,
  Platform,
  PermissionsAndroid,
} from 'react-native';
import {
  RTCPeerConnection,
  mediaDevices,
  RTCView,
  MediaStream,
  RTCSessionDescription,
  RTCIceCandidate,
} from 'react-native-webrtc';
import io from 'socket.io-client';

const configuration = {
  iceServers: [
    {
      urls: ['stun:stun1.l.google.com:19302', 'stun:stun2.l.google.com:19302'],
    },
  ],
};

const App = () => {
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const peerConnection = useRef<RTCPeerConnection | null>(null);
  const socket = useRef<any>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // Socket.IO initialization
    const newSocket = io(
      Platform.OS === 'ios' ? `http://localhost:3000` : `http://10.0.2.2:3000`,
      {
        transports: ['polling', 'websocket'],
        reconnection: true,
        reconnectionAttempts: 5,
        reconnectionDelay: 1000,
      },
    );
    console.log('newSocket', newSocket);
    socket.current = newSocket;

    // WebRTC peer connection
    const pc = new RTCPeerConnection(configuration);
    peerConnection.current = pc;

    pc.onicecandidate = event => {
      if (event.candidate) {
        socket.current?.emit('ice-candidate', {
          candidate: event.candidate,
          room: 'test-room',
        });
      }
    };

    pc.ontrack = event => {
      setRemoteStream(event.streams[0]);
    };

    // --- IMPORTANT: Add socket listeners for signaling ---
    newSocket.on('offer', async data => {
      if (!peerConnection.current) return;
      await peerConnection.current.setRemoteDescription(
        new RTCSessionDescription(data.offer),
      );
      const answer = await peerConnection.current.createAnswer();
      await peerConnection.current.setLocalDescription(answer);
      newSocket.emit('answer', {answer, room: 'test-room'});
    });

    newSocket.on('answer', data => {
      peerConnection.current?.setRemoteDescription(
        new RTCSessionDescription(data.answer),
      );
    });

    newSocket.on('ice-candidate', data => {
      peerConnection.current?.addIceCandidate(
        new RTCIceCandidate(data.candidate),
      );
    });
    // --- End of signaling listeners ---

    newSocket.on('connect', () => console.log('Socket connected'));
    newSocket.on('connect_error', err => {
      console.error('Socket error:', err);
      setError('Failed to connect to signaling server');
    });

    return () => {
      pc.close();
      newSocket.disconnect();
    };
  }, []);

  const requestPermissions = async () => {
    if (Platform.OS === 'android') {
      const granted = await PermissionsAndroid.requestMultiple([
        PermissionsAndroid.PERMISSIONS.CAMERA,
        PermissionsAndroid.PERMISSIONS.RECORD_AUDIO,
      ]);

      return (
        granted['android.permission.CAMERA'] ===
          PermissionsAndroid.RESULTS.GRANTED &&
        granted['android.permission.RECORD_AUDIO'] ===
          PermissionsAndroid.RESULTS.GRANTED
      );
    }
    return true;
  };

  const startCall = async () => {
    try {
      const hasPermission = await requestPermissions();
      if (!hasPermission) return;

      if (
        !peerConnection.current ||
        peerConnection.current.connectionState === 'closed'
      ) {
        throw new Error('Peer connection not available');
      }

      setError(null);
      console.log('Starting call...');

      const stream = await mediaDevices.getUserMedia({
        audio: true,
        video: {
          width: {min: 640, ideal: 1280, max: 1920},
          height: {min: 480, ideal: 720, max: 1080},
          frameRate: {min: 15, ideal: 30, max: 60},
          facingMode: 'user',
        },
      });

      setLocalStream(stream);

      stream.getTracks().forEach(track => {
        peerConnection.current?.addTrack(track, stream);
      });

      const offer = await peerConnection.current.createOffer({
        offerToReceiveAudio: true,
        offerToReceiveVideo: true,
      });
      console.log('offer', offer);
      // await peerConnection.current.setLocalDescription(offer);
      console.log('peerConnection.current', peerConnection.current);

      socket.current?.emit('join-room', 'test-room');
      socket.current?.emit('offer', {offer, room: 'test-room'});

      setIsConnected(true);
    } catch (err) {
      console.error('Error in startCall:', err);
      setError(err instanceof Error ? err.message : 'Failed to start call');
    }
  };

  const endCall = () => {
    try {
      if (localStream) {
        localStream.getTracks().forEach(track => track.stop());
      }
      if (peerConnection) {
        peerConnection.close();
      }
      setLocalStream(null);
      setRemoteStream(null);
      setIsConnected(false);
      setError(null);
    } catch (err) {
      console.error('Error in endCall:', err);
      setError('Failed to end call properly');
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.videoContainer}>
        {localStream && (
          <RTCView
            streamURL={localStream.toURL()}
            style={styles.videoStream}
            objectFit="cover"
          />
        )}
        {remoteStream && (
          <RTCView
            streamURL={remoteStream.toURL()}
            style={styles.videoStream}
            objectFit="cover"
          />
        )}
      </View>
      {error && (
        <View style={styles.errorContainer}>
          <Text style={styles.errorText}>{error}</Text>
        </View>
      )}
      <View style={styles.buttonContainer}>
        <TouchableOpacity
          style={[
            styles.button,
            isConnected ? styles.buttonEnd : styles.buttonStart,
          ]}
          onPress={isConnected ? endCall : startCall}>
          <Text style={styles.buttonText}>
            {isConnected ? 'End Call' : 'Start Call'}
          </Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F5F5F5',
  },
  videoContainer: {
    flex: 1,
    flexDirection: 'row',
    justifyContent: 'space-around',
    alignItems: 'center',
    padding: 20,
  },
  videoStream: {
    width: '45%',
    height: 200,
    backgroundColor: '#E0E0E0',
    borderRadius: 10,
  },
  buttonContainer: {
    padding: 20,
    alignItems: 'center',
  },
  button: {
    padding: 15,
    borderRadius: 25,
    width: 200,
    alignItems: 'center',
  },
  buttonStart: {
    backgroundColor: '#4CAF50',
  },
  buttonEnd: {
    backgroundColor: '#F44336',
  },
  buttonText: {
    color: 'white',
    fontSize: 16,
    fontWeight: 'bold',
  },
  errorContainer: {
    padding: 10,
    margin: 10,
    backgroundColor: '#FFEBEE',
    borderRadius: 5,
  },
  errorText: {
    color: '#D32F2F',
    textAlign: 'center',
  },
});

export default App;

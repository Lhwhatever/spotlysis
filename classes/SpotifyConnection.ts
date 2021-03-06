import axios, { AxiosRequestConfig } from 'axios';
import Paged, { SpotifyPage } from 'classes/Paged';
import { AudioFeatures, Playlist, TrackSimplified } from 'classes/SpotifyObjects';
import querystring from 'querystring';

const apiHost = 'https://api.spotify.com';
const apiVersion = 'v1';
const apiRoot = `${apiHost}/${apiVersion}`;

export type FetchConfig = AxiosRequestConfig;
export type MethodConfig = Omit<FetchConfig, 'method'>;

export interface FetchResult<T = unknown> {
    data: T;
    status: number;
}

export interface Images {
    width: number;
    height: number;
    url: string;
}

export interface UserProfile {
    display_name: string;
    external_urls: { spotify: string };
    followers: { href: null; total: number };
    href: string;
    id: string;
    images: Images[];
    type: 'user';
    uri: string;
}

interface EstablishOptions {
    accessToken: string;
    refreshToken: string;

    /**
     * An optional callback to be run if the user profile is
     * successfully gotten.
     */
    onGettingUserProfile?: (profile: UserProfile) => void;

    /**
     * An optional callback to be run whenever the access token
     * changes.
     */
    onAccessTokenChange?: (newToken: string) => void;
}

/**
 * Represents an authorized connection to a user's Spotify account, with the
 * ability to refresh its access token if it has expired. It can use Spotify's
 * RESTful API to fetch information about the user and music on Spotify's
 * database.
 */
export default class SpotifyConnection {
    private constructor(
        private _accessToken: string,
        public readonly refreshToken: string,
        private readonly onAccessTokenChange: (newToken: string) => void
    ) {
        this.fetchAudioFeatures = this.fetchAudioFeatures.bind(this);
    }

    /**
     * Instantiates SpotifyConnection with the given tokens and verifies
     * whether the tokens work.
     *
     * @param options An object containing the inputs to try establishing the
     * connection with.
     * @returns A Promise of the SpotifyConnection. Rejects if there was an
     * error establishing the connection, e.g. HTTP 401 for invalid tokens.
     */
    public static async establish(options: EstablishOptions): Promise<SpotifyConnection> {
        const {
            accessToken,
            refreshToken,
            onGettingUserProfile = () => undefined,
            onAccessTokenChange = () => undefined,
        } = options;

        const connection = new SpotifyConnection(accessToken, refreshToken, onAccessTokenChange);
        onGettingUserProfile(await connection.fetchUserProfile());
        return connection;
    }

    public get accessToken(): string {
        return this._accessToken;
    }

    /**
     * Like SpotifyConnection.establish, but only requires the refresh token.
     *
     * @param options An object containing the inputs to try establishing the
     * connection with.
     * @returns A Promise of the SpotifyConnection. Rejects if there was an
     * error establishing the connection, e.g. HTTP 401 for invalid tokens.
     */
    public static async reestablish(options: Omit<EstablishOptions, 'accessToken'>): Promise<SpotifyConnection> {
        const { refreshToken, onGettingUserProfile = () => undefined, onAccessTokenChange = () => undefined } = options;

        const connection = new SpotifyConnection('', refreshToken, onAccessTokenChange);
        await connection.tryRefresh();
        onGettingUserProfile(await connection.fetchUserProfile());
        return connection;
    }

    protected async fetch<T>(endpoint?: string, config: FetchConfig = {}): Promise<FetchResult<T>> {
        const headers = { ...config.headers, Authorization: `Bearer ${this.accessToken}` };
        const { data, status } = await axios({ ...config, headers, url: endpoint ? apiRoot + endpoint : config.url });
        return { data, status };
    }

    /**
     * Attempts to refresh the connection with the given refresh token.
     * Rejects with the Axios error if there is a failure.
     *
     * @returns A Promise of the new access token. _accessToken is
     * automatically replaced with the new access token.
     */
    public async tryRefresh(): Promise<string> {
        const response = await axios({
            url:
                '/api/refresh?' +
                querystring.stringify({
                    refresh_token: this.refreshToken,
                }),
            method: 'GET',
        });

        if (response.status !== 200) throw response;
        this._accessToken = response.data.access_token;
        return this.accessToken;
    }

    protected async get<T>(endpoint?: string, config: MethodConfig = {}): Promise<FetchResult<T>> {
        try {
            return this.fetch(endpoint, { ...config, method: 'get' });
        } catch (error) {
            if (error.isAxiosError && error.response.status === 401) {
                this.onAccessTokenChange(await this.tryRefresh());
                return this.fetch(endpoint, { ...config, method: 'get' });
            }

            throw error;
        }
    }

    /**
     * Gets the user's profile from Spotify's database.
     *
     * @returns A Promise of the user's profile. Rejects on HTTP failure
     * statuses.
     */
    public async fetchUserProfile(): Promise<UserProfile> {
        const { data, status } = await this.get<UserProfile>('/me');
        if (status !== 200) throw status;
        return data;
    }

    /**
     * Gets the user's playlists from Spotify's database.
     *
     * @param perPage The number of playlists to fetch each page. Defaults to 50.
     * @returns A Promise of a Paged container of the user's playlists.
     */
    public async fetchUserPlaylists(perPage = 50): Promise<Paged<Playlist>> {
        const fetcher = async (limit: number, offset: number) =>
            (
                await this.get<SpotifyPage<Playlist>>('/me/playlists', {
                    params: { limit, offset },
                })
            ).data;

        return Paged.create(perPage, fetcher);
    }

    /**
     * Gets the tracks within a specified playlist.
     *
     * @param id The Spotify ID of the playlist.
     * @param perPage The number of playlists to fetch per page. Defaults to 100.
     * @returns A promise of a Paged container of the playlist's tracks.
     */
    public async fetchPlaylistTracks(id: string, perPage = 100): Promise<Paged<TrackSimplified>> {
        const fetcher = async (limit: number, offset: number) =>
            (
                await this.get<SpotifyPage<TrackSimplified>>(`/playlists/${id}/tracks`, {
                    params: { limit, offset },
                })
            ).data;

        return Paged.create(perPage, fetcher);
    }

    private async fetchAudioFeaturesOfBucket(ids: string[]): Promise<AudioFeatures[]> {
        const result = await this.get<{ audio_features: AudioFeatures[] }>('/audio-features', {
            params: { ids: ids.join(',') },
        });

        if (result.status !== 200) throw result.status;
        return result.data.audio_features;
    }

    /**
     * Gets the audio features of specified tracks.
     *
     * @param ids An array of the Spotify IDs of the tracks.
     * @returns A Promise of an array of the audio features.
     */
    public async fetchAudioFeatures(ids: string[]): Promise<AudioFeatures[]> {
        const bucketSize = Math.ceil(ids.length / Math.ceil(ids.length / 100));
        const buckets: string[][] = [];

        // split the ids into buckets
        for (let i = 0; i < ids.length; i += bucketSize) {
            buckets.push(ids.slice(i, i + bucketSize));
        }

        return (await Promise.all(buckets.map((bucket) => this.fetchAudioFeaturesOfBucket(bucket)))).flat();
    }
}

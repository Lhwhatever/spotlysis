import { Checkbox, makeStyles, TableCell, TableRow, Typography } from '@material-ui/core';
import React from 'react';
import { useDispatch } from 'react-redux';
import { selectTrackInPlaylist, StagedTrack } from 'store/ducks/TrackManager';

const useStyles = makeStyles((theme) => ({
    mainCell: {
        display: 'flex',
        flexDirection: 'column',
    },
    muted: {
        color: theme.palette.text.secondary,
    },
}));

export type TrackRowProps = StagedTrack & {
    playlistUri: string;
    artistNames: string;
};

const TrackRow = (props: TrackRowProps): JSX.Element => {
    const { data, selected, playlistUri: activePlaylistUri, artistNames } = props;

    const dispatch = useDispatch();

    const classes = useStyles();

    const handleCheck = (event: React.ChangeEvent<HTMLInputElement>) => {
        dispatch(selectTrackInPlaylist(activePlaylistUri, data.track.uri, event.target.checked));
    };

    const seconds = Math.round(data.track.duration_ms / 1000);
    const duration = `${Math.floor(seconds / 60)}:${(seconds % 60).toString().padStart(2, '0')}`;

    return (
        <TableRow>
            <TableCell padding="checkbox">
                <Checkbox checked={selected} onChange={handleCheck} />
            </TableCell>
            <TableCell className={classes.mainCell}>
                <span>{data.track.name}</span>
                <Typography variant="caption" className={classes.muted}>
                    {artistNames}
                    {' · '}
                    {data.track.album.name}
                </Typography>
            </TableCell>
            <TableCell className={classes.muted} padding="none">
                {duration}
            </TableCell>
        </TableRow>
    );
};

export default TrackRow;
